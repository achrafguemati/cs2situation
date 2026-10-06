#include "pch.hpp"

void f::bomb::get_carried_bomb(c_base_entity* bomb)
{
	if (!bomb)
		return;

	// Only record that a C_C4 exists and grab its position. Whether it is CARRIED
	// or DROPPED is decided in f::get_player_info() from the inventories, not from
	// m_hOwnerEntity: the C4's own scene node follows the carrier around, which is
	// exactly why an owner-handle check kept drawing a "dropped looking" marker
	// that moved across the map.
	m_c4_found = true;

	const auto scene_origin = bomb->get_scene_origin();
	if (scene_origin.is_zero())
		return;

	m_c4_has_position = true;
	m_data["m_bomb"]["x"] = scene_origin.m_x;
	m_data["m_bomb"]["y"] = scene_origin.m_y;
}

void f::bomb::get_planted_bomb(c_planted_c4* planted_c4)
{
	if (!planted_c4)
		return;

	if (!planted_c4->m_bBombTicking())
		return;

	const auto curtime = i::m_global_vars->m_curtime();

	const auto blow_time = (planted_c4->m_flC4Blow() - curtime);
	if (blow_time <= 0.f)
		return;

	const auto scene_node = planted_c4->m_pGameSceneNode();
	if (!scene_node)
		return;

	const auto vec_origin = scene_node->m_vecAbsOrigin();
	if (vec_origin.is_zero())
		return;

	const auto is_defused = planted_c4->m_bBombDefused();
	const auto is_defusing = planted_c4->m_bBeingDefused();
	const auto defuse_time = (planted_c4->m_flDefuseCountDown() - curtime);

	m_bomb_planted = true;

	m_data["m_bomb"]["x"] = vec_origin.m_x;
	m_data["m_bomb"]["y"] = vec_origin.m_y;
	m_data["m_bomb"]["m_state"] = "planted";
	m_data["m_bomb"]["m_blow_time"] = blow_time;
	m_data["m_bomb"]["m_is_defused"] = is_defused;
	m_data["m_bomb"]["m_is_defusing"] = is_defusing;
	m_data["m_bomb"]["m_defuse_time"] = defuse_time;
}
