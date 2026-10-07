#include "pch.hpp"

bool main()
{
    config_data_t config_data = {};
    INIT_STEP("config system", cfg::setup(config_data));
    INIT_STEP("memory", m_memory->setup());
    INIT_STEP("interfaces", i::setup());
    INIT_STEP("schema", schema::setup());

    // Warm the portrait cache from the previous run, so players who are already
    // dead at startup still show a character instead of a blank placeholder.
    f::players::load_model_cache();

    ix::initNetSystem();
    LOG_INFO("winsock initialization completed");

    // Must match the path the Node bridge listens on (webapp/ws/app.js) and the
    // URL the front end connects to (webapp/src/app.jsx). All three together.
    const auto formatted_address = std::format("ws://{}:22006/cs2situation", config_data.m_ip);

    // The bridge authenticates each socket as a feed on its own connection, so the
    // handshake has to be repeated on EVERY (re)connect. Sending it once before the
    // tick loop meant that restarting the bridge silently killed the feed forever:
    // the exe reconnected, was no longer flagged as the feed, and every tick was
    // rejected as an unauthenticated publish.
    const auto feed_auth = nlohmann::json{
        { "type", "feed_auth" },
        { "token", config_data.m_secret }
    };

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

            // Re-authenticate immediately. ixwebsocket reuses this socket object
            // across reconnects, so this is what makes the feed survive a bridge
            // restart instead of dying quietly.
            web_socket.send(feed_auth.dump());
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

    for (;;)
    {
        // One bad read must not end the session. Reads themselves cannot throw
        // (ReadProcessMemory fails cleanly), but string and container work on
        // game-supplied data can throw std::out_of_range / bad_alloc - and an
        // uncaught exception here would terminate usermode.exe mid-tick, which is
        // exactly the crash class this program is supposed to survive.
        //
        // Identical throws are logged once rather than 10x a second.
        try
        {
            sdk::update();
            f::run();
            web_socket.send(f::m_data.dump());
        }
        catch (const std::exception& e)
        {
            static std::string last_error;
            if (last_error != e.what())
            {
                last_error = e.what();
                LOG_ERROR("tick failed, recovered: %s", e.what());
            }
        }
        catch (...)
        {
            static bool reported = false;
            if (!reported)
            {
                reported = true;
                LOG_ERROR("tick failed with an unknown exception, recovered");
            }
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    return true;
}