#include "pch.hpp"

namespace
{
	// Weapon data names come from the game as "weapon_ak47" and the frontend
	// looks up assets/icons/<name>.svg, so the prefix has to go.
	// The previous erase(begin(), begin() + 7) was unguarded: any name shorter
	// than 7 characters made it throw std::out_of_range, uncaught, mid-tick.
	// Only strip the prefix when it is actually there, which also keeps names
	// that do not carry it intact.
	std::string strip_weapon_prefix(std::string name)
	{
		constexpr std::string_view prefix = "weapon_";
		if (name.starts_with(prefix))
			name.erase(0, prefix.size());

		return name;
	}

	// A dead pawn has no game scene node, so get_model_name() returns "" and the
	// frontend has no portrait to draw. Entity slots (m_idx) get recycled on
	// respawn, so remember the model per player NAME instead - that identity is
	// stable for the whole session and lets a dead player's portrait persist.
	// (Not the Steam ID: m_steamID reads back as 0 for every player in CS2.)
	//
	// Persisted to models_cache.json so it survives restarts. Without this the
	// cache starts empty every launch, so anyone already dead when the exe starts
	// has no portrait until they respawn once.
	std::unordered_map<std::string, std::string> model_name_cache;
	constexpr const char* cache_path = "models_cache.json";
	bool dirty = false;

	void load_model_cache_impl()
	{
		std::ifstream file(cache_path);
		if (!file.is_open())
			return;

		try
		{
			const auto parsed = nlohmann::json::parse(file);
			if (parsed.is_object())
			{
				for (const auto& [name, model] : parsed.items())
				{
					if (model.is_string())
						model_name_cache[name] = model.get<std::string>();
				}
			}
		}
		catch (...)
		{
			model_name_cache.clear();
		}
	}

	void save_model_cache()
	{
		// Writing on every change would hammer the disk 10x/sec, so mark it dirty
		// and let the caller flush periodically instead.
		if (!dirty)
			return;

		dirty = false;

		try
		{
			nlohmann::json out = nlohmann::json::object();
			for (const auto& [name, model] : model_name_cache)
				out[name] = model;

			std::ofstream file(cache_path);
			if (file.is_open())
				file << out.dump(2);
		}
		catch (...)
		{
			// Never let a cache write take the process down.
		}
	}
} // namespace

void f::players::load_model_cache()
{
	load_model_cache_impl();
}

bool f::players::get_data(int32_t idx, c_cs_player_controller* player, c_cs_player_pawn* player_pawn)
{
	const auto health = player_pawn->m_iHealth();
	const auto is_dead = health <= 0;
	const auto vec_origin = player->get_vec_origin();
	const auto team = player->m_iTeamNum();

	m_player_data["m_idx"] = idx;
	m_player_data["m_is_local"] = (player == sdk::m_local_controller);
	m_player_data["m_name"] = player->m_sSanitizedPlayerName();
	m_player_data["m_color"] = player->get_color();
	m_player_data["m_team"] = team;
	m_player_data["m_health"] = health;
	m_player_data["m_is_dead"] = is_dead;

	// A dead pawn does NOT report an empty model - CS2 swaps the model to the
	// observer/spectator rig ("cs_observer"), which has no portrait asset. That
	// bogus name used to overwrite the real cached one, so the portrait vanished
	// on death. Treat it as "no model" and keep the last good character model.
	//
	// Keyed by player NAME: m_steamID reads back as 0 for every player in CS2,
	// so a steam-ID key would never populate and would collide everyone onto one
	// entry. The sanitized name is unique per player and already read above.
	const auto& player_name = m_player_data["m_name"].get_ref<const std::string&>();
	const auto live_model = player_pawn->get_model_name();
	const auto has_real_model = !live_model.empty() && !live_model.starts_with("cs_observer");

	if (has_real_model)
	{
		if (model_name_cache.size() > 256)
			model_name_cache.clear();

		// Only mark dirty when the value actually changes, so a steady roster
		// does not trigger a disk write on every tick.
		const auto it = model_name_cache.find(player_name);
		if (it == model_name_cache.end() || it->second != live_model)
		{
			model_name_cache[player_name] = live_model;
			dirty = true;
		}
	}

	// Flush at most roughly every 5 seconds.
	static auto next_save = std::chrono::steady_clock::now();
	if (const auto now = std::chrono::steady_clock::now(); now >= next_save)
	{
		next_save = now + std::chrono::seconds(5);
		save_model_cache();
	}

	// Fall back to the cached character model. Crucially, if there is no cache
	// entry (this player has not been seen alive since the exe started) we must
	// send an EMPTY string, not live_model - otherwise cs_observer goes on the
	// wire and the frontend blanks the portrait anyway.
	std::string model_name;
	if (const auto it = model_name_cache.find(player_name); it != model_name_cache.end())
		model_name = it->second;

	m_player_data["m_model_name"] = model_name;
	m_player_data["m_steam_id"] = std::to_string(player->m_steamID());
	m_player_data["m_armor"] = player_pawn->m_ArmorValue();

	// These services can be null (menu / warmup / round transitions). Dereferencing
	// them unguarded is what crashed usermode.exe before.
	const auto money_services = player->m_pInGameMoneyServices();
	m_player_data["m_money"] = money_services ? money_services->m_iAccount() : 0;

	const auto item_services = player_pawn->m_pItemServices();
	m_player_data["m_has_helmet"] = item_services ? item_services->m_bHasHelmet() : false;
	m_player_data["m_has_defuser"] = item_services ? item_services->m_bHasDefuser() : false;

	m_player_data["m_position"]["x"] = vec_origin.m_x;
	m_player_data["m_position"]["y"] = vec_origin.m_y;
	m_player_data["m_eye_angle"] = player_pawn->m_angEyeAngles().m_y;
	m_player_data["m_weapons"] = nlohmann::json{};

	// m_player_data is only cleared once per tick, not per player, so an unset key
	// would inherit the previous player's value. Always write it explicitly.
	// get_weapons() below promotes this to true if the C4 turns up in this pawn's
	// own inventory - that is the only carrier signal we trust.
	m_player_data["m_has_bomb"] = false;

	return true;
}

void f::players::get_weapons(c_cs_player_pawn* player_pawn)
{
	const auto weapon_services = player_pawn->m_pWeaponServices();
	if (!weapon_services)
		return;

	const auto my_weapons = weapon_services->m_hMyWeapons();
	if (!my_weapons.m_size)
		return;

	std::set<std::string> utilities_set{};
	std::set<std::string> melee_set{};

	for (size_t idx{ 0 }; idx < my_weapons.m_size; idx++)
	{
		const auto weapon = my_weapons.m_elements->get(idx);
		if (!weapon)
			continue;

		const auto weapon_data = weapon->m_WeaponData();
		if (!weapon_data)
			continue;

		auto weapon_name = strip_weapon_prefix(weapon_data->m_szName());
		if (weapon_name.empty())
			continue;

		const auto weapon_type = weapon_data->m_WeaponType();
		switch (weapon_type)
		{
			case e_weapon_type::submachinegun:
			case e_weapon_type::rifle:
			case e_weapon_type::shotgun:
			case e_weapon_type::sniper_rifle:
			case e_weapon_type::machinegun:
				m_player_data["m_weapons"]["m_primary"] = weapon_name;
				break;

			case e_weapon_type::pistol:
				m_player_data["m_weapons"]["m_secondary"] = weapon_name;
				break;

			case e_weapon_type::knife:
			case e_weapon_type::taser:
				melee_set.insert(weapon_name);
				break;

			case e_weapon_type::grenade:
				utilities_set.insert(weapon_name);
				break;

			// The C4 in someone's inventory IS the carrier signal. Reading it here
			// means no ordering assumptions and nothing carried across ticks.
			case e_weapon_type::c4:
				m_player_data["m_has_bomb"] = true;
				break;
		}
	}

	m_player_data["m_weapons"]["m_melee"] = std::vector<std::string>(melee_set.begin(), melee_set.end());
	m_player_data["m_weapons"]["m_utilities"] = std::vector<std::string>(utilities_set.begin(), utilities_set.end());
}

void f::players::get_active_weapon(c_cs_player_pawn* player_pawn)
{
	const auto weapon_services = player_pawn->m_pWeaponServices();
	if (!weapon_services)
		return;

	const auto weapon_handle = weapon_services->m_hActiveWeapon();
	if (!weapon_handle.is_valid())
		return;

	const auto active_weapon = i::m_game_entity_system->get<c_base_player_weapon*>(weapon_handle);
	if (!active_weapon)
		return;

	const auto weapon_data = active_weapon->m_WeaponData();
	if (!weapon_data)
		return;

	auto weapon_name = strip_weapon_prefix(weapon_data->m_szName());
	if (weapon_name.empty())
		return;

	m_player_data["m_weapons"]["m_active"] = weapon_name;
}