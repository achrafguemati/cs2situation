#include "pch.hpp"

bool cfg::setup(config_data_t& config_data)
{
	std::ifstream file("config.json");
	if (!file.is_open())
	{
		LOG_WARNING("cannot open file 'config.json'");

		std::ofstream example_config("config.json");
		example_config << std::format("{}", R"({
    "m_ip": "localhost",
    "m_secret": "cs2situation-local-dev-secret"
})");

		return {};
	}

	const auto parsed_data = nlohmann::json::parse(file);
	if (parsed_data.empty())
	{
		LOG_ERROR("failed to parse 'config.json'");
		return {};
	}

	try
	{
		// value() falls back to a default when a key is missing, so an older
		// config.json that predates m_secret still loads instead of throwing.
		config_data.m_ip = parsed_data.value("m_ip", std::string("localhost"));
		config_data.m_secret = parsed_data.value("m_secret", std::string("cs2situation-local-dev-secret"));
	}
	catch (const std::exception& e)
	{
		LOG_ERROR("failed to read 'config.json' (%s)", e.what());
		return {};
	}

	// The built-in secret is published in this repo, so it is not security.
	// Warn loudly so nobody mistakes it for protection: set a real m_secret
	// before the bridge is reachable from anything but the local machine.
	if (config_data.m_secret == "cs2situation-local-dev-secret")
		printf(" [warning] using the default feed secret - set a real 'm_secret' in config.json before exposing the bridge to a network\n");

	return true;
}