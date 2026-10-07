#include "pch.hpp"

void f::bomb::get_carried_bomb(c_c4* bomb)
{
	if (!bomb)
		return;

	// Only record that a C_C4 exists and grab its position. Whether it is CARRIED
	// or DROPPED is decided in f::get_player_info() from the inventories, not from
	// m_hOwnerEntity: the C4's own scene node follows the carrier around, which is
	// exactly why an owner-handle check kept drawing a "dropped looking" marker
	// that moved across the map.
	m_c4_found = true;

	// There is no plant-in-progress signal in CS2, proven by measurement:
	//
	//   C_C4->m_bBombPlanted 0->1  at 5826.688
	//   C_PlantedC4 ticking began   at 5826.688   <- identical millisecond
	//
	// So m_bBombPlanted flips when the plant COMPLETES, not when it starts; it can
	// only ever flag a single tick, which is useless as a 3.2s plant readout.
	// C_C4->m_bStartedArming and C_C4->m_fArmedTime do exist, but both change
	// every round rather than on plant, so they are round-start signals.
	//
	// Carried / dropped / planted is therefore the full set of states we can
	// report truthfully. Nothing here guesses.

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

	// A non-ticking C_PlantedC4 is not a bomb we care about: the entity only
	// appears once the plant has finished, and there is no plant-in-progress
	// state to report (measured - see get_carried_bomb). We only read the tick.
	//
	// Note on safety: a field name that fails to resolve yields offset 0, which is
	// indistinguishable from a real offset 0 and would silently read unrelated
	// memory. That is why nothing unverified is read here.
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
