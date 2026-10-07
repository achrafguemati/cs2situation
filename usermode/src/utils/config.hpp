#pragma once

struct config_data_t
{
	std::string m_ip;
	std::string m_secret;

	NLOHMANN_DEFINE_TYPE_INTRUSIVE(config_data_t, m_ip, m_secret)
};

namespace cfg
{
	bool setup(config_data_t& config_data);
}