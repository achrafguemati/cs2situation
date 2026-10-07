#include "pch.hpp"
#include <cstdio>

namespace
{
	// A null address here means either the signature was not found (no dereference
	// at all, so no UB) or its target pointer read back as 0.
	// Callers already treat a null result as "no local player".
	uintptr_t resolve_local_player_controller()
	{
		const auto result = m_memory->find_pattern(CLIENT_DLL, GET_LOCAL_PLAYER_CONTROLLER);
		if (!result.has_value())
		{
			printf(" [error] signature '%s' not found in '%s'\n", GET_LOCAL_PLAYER_CONTROLLER, CLIENT_DLL);
			return 0;
		}

		return result->rip().as<uintptr_t>();
	}
} // namespace

const c_base_handle c_entity_instance::get_ref_e_handle()
{
	const auto entity = m_pEntity();
	if (!entity)
		return c_base_handle();

	return c_base_handle(entity->get_entry_idx(), entity->get_serial_number() - (entity->m_flags() & 1));
}

const std::string c_entity_instance::get_schema_class_name()
{
	const auto entity = m_pEntity();
	if (!entity)
		return {};

	const auto class_info = entity->m_pClassInfo();
	if (!class_info)
		return {};

	const auto unk1 = m_memory->read_t<uintptr_t>(class_info + 0x58);
	if (!unk1)
		return {};

	const auto unk2 = m_memory->read_t<uintptr_t>(unk1 + 0x08);
	if (!unk2)
		return {};

	// The class name for a given class_info never changes. Cache by pointer so we
	// avoid a std::string heap allocation for every entity on every tick.
	static std::mutex cache_mutex;
	static std::unordered_map<uintptr_t, std::string> name_cache;

	{
		std::lock_guard lock(cache_mutex);
		if (const auto it = name_cache.find(unk2); it != name_cache.end())
			return it->second;
	}

	auto name = m_memory->read_t<std::string>(unk2);

	{
		std::lock_guard lock(cache_mutex);
		if (name_cache.size() > 4096)
			name_cache.clear();
		name_cache[unk2] = name;
	}

	return name;
}

const std::string c_cs_player_pawn::get_model_name()
{
	const auto model_name = m_memory->read_t<uintptr_t>(m_pGameSceneNode() + SCHEMA_GET_OFFSET("CSkeletonInstance->m_modelState") + SCHEMA_GET_OFFSET("CModelState->m_ModelName"));
	if (!model_name)
		return {};

	const auto model_path = m_memory->read_t<std::string>(model_name);
	if (model_path.empty())
		return {};

	// rfind returns npos when the delimiter is missing; the old arithmetic then
	// underflowed size_t and passed a huge length to substr, which throws
	// std::out_of_range. Derive the last component from first principles instead.
	const auto slash_index = model_path.rfind('/');
	const auto file_name = (slash_index == std::string::npos) ? model_path : model_path.substr(slash_index + 1);

	const auto extension_index = file_name.rfind('.');
	const auto stem = (extension_index == std::string::npos) ? file_name : file_name.substr(0, extension_index);

	// The caller treats this as a path component (assets/characters/<name>.png).
	// Never return an empty one, or it would request "characters/.png".
	return stem.empty() ? std::string("unknown") : stem;
}

c_cs_player_controller* c_cs_player_controller::get_local_player_controller()
{
	static const auto offset = resolve_local_player_controller();
	if (!offset)
		return {};

	return m_memory->read_t<c_cs_player_controller*>(offset);
}

c_cs_player_pawn* c_cs_player_controller::get_player_pawn()
{
	const auto& handle = m_hPawn();
	return i::m_game_entity_system->get<c_cs_player_pawn*>(handle);
}

const e_colors c_cs_player_controller::get_color()
{
	const auto color = m_iCompTeammateColor();
	if (color == static_cast<e_colors>(-1))
		return e_colors::white;

	return color;
}

f_vector c_cs_player_controller::get_vec_origin()
{
	const auto pawn = get_player_pawn();
	if (!pawn)
		return {};

	return pawn->get_scene_origin();
}

f_vector c_base_entity::get_scene_origin()
{
	const auto game_scene_node = m_pGameSceneNode();
	if (!game_scene_node)
		return {};

	return game_scene_node->m_vecAbsOrigin();
}

c_base_player_weapon* c_base_player_weapon::get(const int32_t idx)
{
	const auto handle = m_memory->read_t<int32_t>(this + idx * 0x4);
	if (handle == -1)
		return nullptr;

	return i::m_game_entity_system->get<c_base_player_weapon*>(handle & ENT_ENTRY_MASK);
}