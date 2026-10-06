#include "pch.hpp"

namespace
{
	// nlohmann::json::get<T>() and operator[] both THROW (type_error / out_of_range)
	// when a key is missing or holds a different type. In Release builds those
	// asserts are compiled out, so a stray payload mismatch would turn into either
	// a std::terminate (killing usermode.exe mid-tick) or undefined behaviour.
	// Every read of a payload key therefore goes through these checked helpers.
	bool json_bool(const nlohmann::json& obj, const char* key)
	{
		if (!obj.is_object())
			return false;

		const auto it = obj.find(key);
		if (it == obj.end() || !it->is_boolean())
			return false;

		return it->get<bool>();
	}

	int32_t json_int(const nlohmann::json& obj, const char* key)
	{
		if (!obj.is_object())
			return -1;

		const auto it = obj.find(key);
		if (it == obj.end() || !it->is_number_integer())
			return -1;

		return it->get<int32_t>();
	}

	float json_num(const nlohmann::json& obj, const char* key)
	{
		if (!obj.is_object())
			return 0.f;

		const auto it = obj.find(key);
		if (it == obj.end() || !it->is_number())
			return 0.f;

		return it->get<float>();
	}
} // namespace

void f::run()
{
	if (!sdk::m_local_controller)
		return;

	const auto local_team = sdk::m_local_controller->m_iTeamNum();
	if (local_team == e_team::none || local_team == e_team::spec)
		return;

	m_data = nlohmann::json{};
	m_player_data = nlohmann::json{};

	m_data["m_local_team"] = local_team;

	get_map();
	get_player_info();
}

void f::get_map()
{
	const auto map_name = i::m_global_vars->m_map_name();
	if (map_name.empty() || map_name.find("<empty>") != std::string::npos)
	{
		m_data["m_map"] = "invalid";

		// find_pattern() copies the WHOLE module into memory and scans it byte by byte.
		// Doing that every tick (10x/sec) causes huge CPU + allocation churn and makes
		// the game stutter, so only retry occasionally.
		static auto next_retry = std::chrono::steady_clock::now();
		const auto now = std::chrono::steady_clock::now();
		if (now < next_retry)
			return;

		next_retry = now + std::chrono::seconds(5);

		LOG_WARNING("failed to get map name! updating m_global_vars");
		const auto pattern = m_memory->find_pattern(CLIENT_DLL, GET_GLOBAL_VARS);
		if (!pattern.has_value())
			return;

		i::m_global_vars = m_memory->read_t<c_global_vars*>(pattern.value().rip().as<c_global_vars*>());
		return;
	}

	m_data["m_map"] = map_name;
}

void f::get_player_info()
{
	m_data["m_players"] = nlohmann::json::array();

	// All bomb state is rebuilt from scratch every tick. Nothing survives from the
	// previous tick, so a stale carrier can never survive a round change.
	m_c4_found = false;
	m_c4_has_position = false;
	m_bomb_planted = false;
	m_bomb_carried = false;

	const auto highest_idx = 1024;
	for (int32_t idx = 0; idx < highest_idx; idx++)
	{
		const auto entity = i::m_game_entity_system->get(idx);
		if (!entity)
			continue;

		const auto entity_handle = entity->get_ref_e_handle();
		if (!entity_handle.is_valid())
			continue;

		const auto class_name = entity->get_schema_class_name();
		if (class_name.empty())
			continue;

		const auto hashed_class_name = fnv1a::hash(class_name);

		if (hashed_class_name == fnv1a::hash("CCSPlayerController"))
		{
			const auto player = i::m_game_entity_system->get<c_cs_player_controller*>(entity_handle);
			if (!player)
				continue;

			const auto player_pawn = player->get_player_pawn();
			if (!player_pawn)
				continue;

			if (!f::players::get_data(idx, player, player_pawn))
				continue;

			// get_weapons() can flag m_has_bomb, so it must run before the push.
			f::players::get_weapons(player_pawn);
			f::players::get_active_weapon(player_pawn);

			m_data["m_players"].push_back(m_player_data);
		}
		else if (hashed_class_name == fnv1a::hash("C_C4"))
		{
			f::bomb::get_carried_bomb(entity);
		}
		else if (hashed_class_name == fnv1a::hash("C_PlantedC4"))
		{
			const auto planted_c4 = reinterpret_cast<c_planted_c4*>(entity);
			f::bomb::get_planted_bomb(planted_c4);
		}
	}

	// Nobody hands us the carrier directly, so read it off the inventories we just
	// filled. get_weapons() set m_has_bomb on whoever actually holds the C4.
	//
	// These reads go through checked helpers on purpose: nlohmann's get<T>() throws
	// (type_error / out_of_range) on a missing or wrongly typed key, and an
	// uncaught exception in here would take usermode.exe down mid-tick.
	auto& players = m_data["m_players"];
	for (auto& player : players)
	{
		if (!json_bool(player, "m_has_bomb"))
			continue;

		const auto team = json_int(player, "m_team");
		if (team != static_cast<int32_t>(e_team::t) || json_bool(player, "m_is_dead"))
		{
			player["m_has_bomb"] = false;
			continue;
		}

		m_bomb_carried = true;
	}

	if (m_bomb_carried)
	{
		// The C4's own scene node trails the carrier, so it can be missing or stale.
		// Falling back to the carrier's own coordinates means the marker can never
		// end up at (0, 0), which the radar treats as an invalid position.
		if (!m_c4_has_position)
		{
			for (const auto& player : players)
			{
				if (!json_bool(player, "m_has_bomb") || !player.contains("m_position"))
					continue;

				const auto& pos = player["m_position"];
				if (!pos.is_object())
					continue;

				const auto x = json_num(pos, "x");
				const auto y = json_num(pos, "y");
				if (x == 0.f && y == 0.f)
					continue;

				m_data["m_bomb"]["x"] = x;
				m_data["m_bomb"]["y"] = y;
				break;
			}
		}

		m_data["m_bomb"]["m_state"] = "carried";
		m_data["m_bomb"]["m_blow_time"] = 0;
		m_data["m_bomb"]["m_is_defused"] = false;
		m_data["m_bomb"]["m_is_defusing"] = false;
	}
	else if (!m_bomb_planted && m_c4_found)
	{
		// A C4 entity exists but no inventory claims it: it is lying on the ground.
		m_data["m_bomb"]["m_state"] = "dropped";
		m_data["m_bomb"]["m_blow_time"] = 0;
		m_data["m_bomb"]["m_is_defused"] = false;
		m_data["m_bomb"]["m_is_defusing"] = false;
	}
}