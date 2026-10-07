#include "pch.hpp"

bool main()
{
    config_data_t config_data = {};
    INIT_STEP("config system", cfg::setup(config_data));
    INIT_STEP("memory", m_memory->setup());
    INIT_STEP("interfaces", i::setup());
    INIT_STEP("schema", schema::setup());

    ix::initNetSystem();
    LOG_INFO("winsock initialization completed");

    // Must match the path the Node bridge listens on (webapp/ws/app.js) and the
    // URL the front end connects to (webapp/src/app.jsx). All three together.
    const auto formatted_address = std::format("ws://{}:22006/cs2situation", config_data.m_ip);

    static ix::WebSocket web_socket;
    std::mutex handshake_mutex;
    std::condition_variable handshake_cv;
    bool connected = false;
    bool failed = false;

    web_socket.setUrl(formatted_address);
    web_socket.setOnMessageCallback([&](const ix::WebSocketMessagePtr& msg)
    {
        if (msg->type == ix::WebSocketMessageType::Open)
        {
            {
                std::lock_guard lock(handshake_mutex);
                connected = true;
            }
            handshake_cv.notify_one();
            LOG_INFO("connected to the web socket ('%s')", formatted_address.c_str());
        }
        else if (msg->type == ix::WebSocketMessageType::Error)
        {
            {
                std::lock_guard lock(handshake_mutex);
                failed = true;
            }
            handshake_cv.notify_one();
            LOG_ERROR("failed to connect to the web socket ('%s')", formatted_address.c_str());
        }
    });
    web_socket.start();

    {
        std::unique_lock lock(handshake_mutex);
        handshake_cv.wait(lock, [&] { return connected || failed; });
    }

    if (!connected)
    {
        std::this_thread::sleep_for(std::chrono::seconds(5));
        return {};
    }

    // Authenticate as the feed before publishing game data. The bridge drops
    // messages from sockets that have not presented the secret, so only this
    // process can push game state to viewers (a browser can never publish).
    const auto feed_auth = nlohmann::json{
        { "type", "feed_auth" },
        { "token", config_data.m_secret }
    };
    web_socket.send(feed_auth.dump());

    for (;;)
    {
        sdk::update();
        f::run();
        web_socket.send(f::m_data.dump());

        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    return true;
}