#pragma once

#include <cstdio>

class c_memory
{
public:
	~c_memory()
	{
		if (this->m_handle != nullptr)
			CloseHandle(this->m_handle);
	}

	bool setup();
	std::optional<uint32_t> get_process_id(const std::string_view& process_name);
	std::optional<c_address> find_pattern(const std::string_view& module_name, const std::string_view& pattern);
	std::pair<std::optional<uintptr_t>, std::optional<uintptr_t>> get_module_info(const std::string_view& module_name);

	// Returns whether the read actually succeeded. Used by find_pattern, which
	// must not scan an uninitialised buffer.
	bool read_t(const uintptr_t address, void* buffer, uintptr_t size)
	{
		return this->read_memory(reinterpret_cast<void*>(address), buffer, size);
	}

	template <typename t>
	t read_t(void* address)
	{
		t value{ 0 };
		if (!this->read_memory(address, &value, sizeof(t)))
			warn_unreadable(reinterpret_cast<uintptr_t>(address), sizeof(t));

		return value;
	}

	template <typename T>
	T read_t(const uintptr_t address) noexcept
	{
		T buffer{};
		if (!this->read_memory(reinterpret_cast<void*>(address), &buffer, sizeof(T)))
			warn_unreadable(address, sizeof(T));

		return buffer;
	}

	template <>
	std::string read_t<std::string>(const uintptr_t address) noexcept
	{
		static const int length = 64;
		std::vector<char> buffer(length);

		if (!this->read_memory(reinterpret_cast<void*>(address), buffer.data(), length))
		{
			warn_unreadable(address, length);
			return {};
		}

		const auto& it = find(buffer.begin(), buffer.end(), '\0');

		if (it != buffer.end())
			buffer.resize(distance(buffer.begin(), it));

		return std::string(buffer.begin(), buffer.end());
	}

private:
	void* m_handle = nullptr;
	uint32_t m_id = 0;

	// A failed read leaves the destination buffer value-initialised, which used to
	// be indistinguishable from real data (a genuine 0, an empty string). The
	// accessors above still return that zero value so no call site changes
	// behaviour, but the failure is now reported instead of being swallowed.
	// Warned once: a dead game would otherwise print this on every field of every
	// entity, ten times a second.
	static void warn_unreadable(const uintptr_t address, const size_t size)
	{
		static bool already_reported = false;
		if (already_reported)
			return;

		already_reported = true;
		printf(" [warning] ReadProcessMemory failed (address 0x%llx, %llu bytes) - reporting once\n",
			static_cast<unsigned long long>(address), static_cast<unsigned long long>(size));
	}

	bool read_memory(void* address, void* buffer, const size_t size)
	{
		return ReadProcessMemory(this->m_handle, reinterpret_cast<void*>(address), buffer, size, nullptr);
	}
};

inline const std::unique_ptr<c_memory> m_memory{ new c_memory() };