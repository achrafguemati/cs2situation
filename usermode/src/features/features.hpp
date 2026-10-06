#pragma once

namespace f::players
{
	bool get_data(int32_t idx, c_cs_player_controller* player, c_cs_player_pawn* player_pawn);
	void get_weapons(c_cs_player_pawn* player_pawn);
	void get_active_weapon(c_cs_player_pawn* player_pawn);
}

namespace f::bomb
{
	void get_carried_bomb(c_base_entity* bomb);
	void get_planted_bomb(c_planted_c4* planted_c4);
}

namespace f
{
	void run();
	void get_map();
	void get_player_info();

	inline nlohmann::json m_data = {};
	inline nlohmann::json m_player_data = {};
	// Bomb state, all rebuilt from scratch every tick so nothing can go stale.
	inline bool m_c4_found = false;          // a C_C4 entity exists
	inline bool m_c4_has_position = false;   // ...and its scene node gave usable coords
	inline bool m_bomb_planted = false;      // a C_PlantedC4 is ticking
	inline bool m_bomb_carried = false;      // some player's inventory holds the C4
}