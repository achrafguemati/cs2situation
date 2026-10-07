#include "pch.hpp"
#include <cinttypes>
#include <cstdio>

namespace
{
	// find_pattern() returns an empty optional when a signature is not found,
	// which happens on every CS2 update that changes the code around it.
	// Calling rip() through an empty optional is UB, so every dereference has to
	// be checked. This collapses the pattern -> rip -> target pointer -> object
	// pointer chain into one null-checked address that callers can test.
	uintptr_t resolve_interface(const std::string_view& module_name, const std::string_view& pattern)
	{
		const auto result = m_memory->find_pattern(module_name, pattern);
		if (!result.has_value())
		{
			printf(" [error] signature not found in '%s'\n", module_name.data());
			return 0;
		}

		const auto address = result->rip().as<uintptr_t>();
		if (address == 0)
		{
			printf(" [error] signature in '%s' resolved to a null address\n", module_name.data());
			return 0;
		}

		return address;
	}
} // namespace

bool i::setup()
{
	bool success = true;

	const auto [client_base, client_size] = m_memory->get_module_info(CLIENT_DLL);
	if (!client_base.has_value() || !client_size.has_value())
		return {};

	const auto schema_system_address = resolve_interface(SCHEMASYSTEM_DLL, GET_SCHEMA_SYSTEM);
	if (schema_system_address != 0)
		// NOTE: unlike the two below, this one is NOT dereferenced. The resolved
		// address IS the schema system object, matching the original behavior.
		// Dereferencing here made m_schema_system point at the pointer VALUE and
		// schema::setup() then read garbage from +0x190.
		m_schema_system = reinterpret_cast<c_schema_system*>(schema_system_address);
	success &= (m_schema_system != nullptr);

	const auto global_vars_address = resolve_interface(CLIENT_DLL, GET_GLOBAL_VARS);
	if (global_vars_address != 0)
		m_global_vars = m_memory->read_t<c_global_vars*>(global_vars_address);
	success &= (m_global_vars != nullptr);

	const auto game_entity_system_address = resolve_interface(CLIENT_DLL, GET_ENTITY_LIST);
	if (game_entity_system_address != 0)
		m_game_entity_system = m_memory->read_t<c_game_entity_system*>(game_entity_system_address);
	success &= (m_game_entity_system != nullptr);

	return success;
}