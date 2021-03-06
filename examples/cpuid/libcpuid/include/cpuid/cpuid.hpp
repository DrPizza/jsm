#ifndef CPUID_HPP
#define CPUID_HPP

#include <cstddef>
#include <array>
#include <map>

#include <gsl/gsl>
#include <fmt/format.h>

#include "suffixes.hpp"

#if defined(_MSC_VER)
#define UNREACHABLE() __assume(0)
#else
#define UNREACHABLE() __builtin_unreachable()
#endif

namespace cpuid {

	enum struct leaf_type : std::uint32_t
	{
		basic_info                        = 0x0000'0000_u32,
		version_info                      = 0x0000'0001_u32,
		cache_and_tlb                     = 0x0000'0002_u32,
		serial_number                     = 0x0000'0003_u32,
		deterministic_cache               = 0x0000'0004_u32,
		monitor_mwait                     = 0x0000'0005_u32,
		thermal_and_power                 = 0x0000'0006_u32,
		extended_features                 = 0x0000'0007_u32,
		reserved_1                        = 0x0000'0008_u32,
		direct_cache_access               = 0x0000'0009_u32,
		performance_monitoring            = 0x0000'000a_u32,
		extended_topology                 = 0x0000'000b_u32,
		reserved_2                        = 0x0000'000c_u32,
		extended_state                    = 0x0000'000d_u32,
		reserved_3                        = 0x0000'000e_u32,
		rdt_monitoring                    = 0x0000'000f_u32,
		rdt_allocation                    = 0x0000'0010_u32,
		reserved_4                        = 0x0000'0011_u32,
		sgx_info                          = 0x0000'0012_u32,
		reserved_5                        = 0x0000'0013_u32,
		processor_trace                   = 0x0000'0014_u32,
		time_stamp_counter                = 0x0000'0015_u32,
		processor_frequency               = 0x0000'0016_u32,
		system_on_chip_vendor             = 0x0000'0017_u32,
		deterministic_tlb                 = 0x0000'0018_u32,
		reserved_6                        = 0x0000'0019_u32,
		reserved_7                        = 0x0000'001a_u32,
		pconfig                           = 0x0000'001b_u32,
		reserved_8                        = 0x0000'001c_u32,
		reserved_9                        = 0x0000'001d_u32,
		reserved_10                       = 0x0000'001e_u32,
		extended_topology_v2              = 0x0000'001f_u32,

		hypervisor_limit                  = 0x4000'0000_u32,

		hyper_v_signature                 = 0x4000'0001_u32,
		hyper_v_system_identity           = 0x4000'0002_u32,
		hyper_v_features                  = 0x4000'0003_u32,
		hyper_v_enlightenment_recs        = 0x4000'0004_u32,
		hyper_v_implementation_limits     = 0x4000'0005_u32,
		hyper_v_implementation_hardware   = 0x4000'0006_u32,
		hyper_v_root_cpu_management       = 0x4000'0007_u32,
		hyper_v_shared_virtual_memory     = 0x4000'0008_u32,
		hyper_v_nested_hypervisor         = 0x4000'0009_u32,
		hyper_v_nested_features           = 0x4000'000a_u32,

		xen_limit                         = 0x4000'0000_u32, xen_limit_offset                  = 0x4000'0100_u32,
		xen_version                       = 0x4000'0001_u32, xen_version_offset                = 0x4000'0101_u32,
		xen_features                      = 0x4000'0002_u32, xen_features_offset               = 0x4000'0102_u32,
		xen_time                          = 0x4000'0003_u32, xen_time_offset                   = 0x4000'0103_u32,
		xen_hvm_features                  = 0x4000'0004_u32, xen_hvm_features_offset           = 0x4000'0104_u32,
		xen_pv_features                   = 0x4000'0005_u32, xen_pv_features_offset            = 0x4000'0105_u32,

		vmware_timing                     = 0x4000'0010_u32,

		kvm_features                      = 0x4000'0001_u32,

		extended_limit                    = 0x8000'0000_u32,
		extended_signature_and_features   = 0x8000'0001_u32,
		brand_string_0                    = 0x8000'0002_u32,
		brand_string_1                    = 0x8000'0003_u32,
		brand_string_2                    = 0x8000'0004_u32,
		l1_cache_identifiers              = 0x8000'0005_u32,
		l2_cache_identifiers              = 0x8000'0006_u32,
		ras_advanced_power_management     = 0x8000'0007_u32,
		address_limits                    = 0x8000'0008_u32,
		reserved_11                       = 0x8000'0009_u32,
		secure_virtual_machine            = 0x8000'000a_u32,

		extended_reserved_1               = 0x8000'000b_u32,
		extended_reserved_2               = 0x8000'000c_u32,
		extended_reserved_3               = 0x8000'000d_u32,
		extended_reserved_4               = 0x8000'000e_u32,
		extended_reserved_5               = 0x8000'000f_u32,
		extended_reserved_6               = 0x8000'0010_u32,
		extended_reserved_7               = 0x8000'0011_u32,
		extended_reserved_8               = 0x8000'0012_u32,
		extended_reserved_9               = 0x8000'0013_u32,
		extended_reserved_10              = 0x8000'0014_u32,
		extended_reserved_11              = 0x8000'0015_u32,
		extended_reserved_12              = 0x8000'0016_u32,
		extended_reserved_13              = 0x8000'0017_u32,
		extended_reserved_14              = 0x8000'0018_u32,
	
		tlb_1g_identifiers                = 0x8000'0019_u32,
		performance_optimization          = 0x8000'001a_u32,
		instruction_based_sampling        = 0x8000'001b_u32,
		lightweight_profiling             = 0x8000'001c_u32,
		cache_properties                  = 0x8000'001d_u32,
		extended_apic                     = 0x8000'001e_u32,
		encrypted_memory                  = 0x8000'001f_u32,

		none                              = 0x0000'0000_u32,
	};

	constexpr inline leaf_type operator++(leaf_type& lhs) {
		lhs = static_cast<leaf_type>(static_cast<std::uint32_t>(lhs) + 1);
		return lhs;
	}

	constexpr inline leaf_type operator+=(leaf_type& lhs, std::uint32_t rhs) {
		lhs = static_cast<leaf_type>(static_cast<std::uint32_t>(lhs) + rhs);
		return lhs;
	}

	constexpr inline leaf_type operator+(const leaf_type& lhs, std::uint32_t rhs) {
		return static_cast<leaf_type>(static_cast<std::uint32_t>(lhs) + rhs);
	}

	enum struct subleaf_type : std::uint32_t
	{
		main                                   = 0x0000'0000_u32,
		extended_features_main                 = 0x0000'0000_u32,
		extended_state_main                    = 0x0000'0000_u32,
		extended_state_sub                     = 0x0000'0001_u32,
		rdt_monitoring_main                    = 0x0000'0000_u32,
		rdt_monitoring_l3                      = 0x0000'0001_u32,
		rdt_allocation_main                    = 0x0000'0000_u32,
		rdt_cat_l3                             = 0x0000'0001_u32,
		rdt_cat_l2                             = 0x0000'0002_u32,
		rdt_mba                                = 0x0000'0003_u32,
		sgx_capabilities                       = 0x0000'0000_u32,
		sgx_attributes                         = 0x0000'0001_u32,
		processor_trace_main                   = 0x0000'0000_u32,
		processor_trace_sub                    = 0x0000'0001_u32,
		system_on_chip_vendor_main             = 0x0000'0000_u32,
		system_on_chip_vendor_sub              = 0x0000'0001_u32,
		deterministic_address_translation_main = 0x0000'0000_u32,
		deterministic_address_translation_sub  = 0x0000'0001_u32,
		xen_time_main                          = 0x0000'0000_u32,
		xen_time_tsc_offset                    = 0x0000'0001_u32,
		xen_time_host                          = 0x0000'0002_u32,
		none                                   = 0x0000'0000_u32,
	};

	constexpr inline subleaf_type operator++(subleaf_type& lhs) {
		lhs = static_cast<subleaf_type>(static_cast<std::uint32_t>(lhs) + 1);
		return lhs;
	}

	constexpr inline subleaf_type operator+=(subleaf_type& lhs, std::uint32_t offset) {
		lhs = static_cast<subleaf_type>(static_cast<std::uint32_t>(lhs) + offset);
		return lhs;
	}

	enum register_type : std::uint8_t
	{
		eax,
		ebx,
		ecx,
		edx,
	};

	constexpr inline register_type operator++(register_type& lhs) {
		lhs = static_cast<register_type>(static_cast<std::uint8_t>(lhs) + 1);
		return lhs;
	}

	enum vendor_type : std::uint32_t
	{
		unknown        = 0x0000'0000_u32,
		// silicon
		amd            = 0x0000'0001_u32,
		centaur        = 0x0000'0002_u32,
		cyrix          = 0x0000'0004_u32,
		intel          = 0x0000'0008_u32,
		transmeta      = 0x0000'0010_u32,
		nat_semi       = 0x0000'0020_u32,
		nexgen         = 0x0000'0040_u32,
		rise           = 0x0000'0080_u32,
		sis            = 0x0000'0100_u32,
		umc            = 0x0000'0200_u32,
		via            = 0x0000'0400_u32,
		vortex         = 0x0000'0800_u32,
		// hypervisors
		bhyve          = 0x0001'0000_u32,
		kvm            = 0x0002'0000_u32,
		hyper_v        = 0x0004'0000_u32,
		parallels      = 0x0008'0000_u32,
		vmware         = 0x0010'0000_u32,
		xen_hvm        = 0x0020'0000_u32,
		xen_viridian   = xen_hvm | hyper_v,
		qemu           = 0x0040'0000_u32,
		// for filtering
		any_silicon    = 0x0000'0fff_u32,
		any_hypervisor = 0x007f'0000_u32,
		any            = 0xffff'ffff_u32,
	};

	constexpr inline vendor_type operator|(const vendor_type& lhs, const vendor_type& rhs) {
		return static_cast<vendor_type>(static_cast<std::uint32_t>(lhs) | static_cast<std::uint32_t>(rhs));
	}

	constexpr inline vendor_type operator&(const vendor_type& lhs, const vendor_type& rhs) {
		return static_cast<vendor_type>(static_cast<std::uint32_t>(lhs) & static_cast<std::uint32_t>(rhs));
	}

	inline std::string to_string(vendor_type vendor) {
		std::string silicon;
		std::string hypervisor;

		switch(vendor & vendor_type::any_silicon) {
		case vendor_type::amd:
			silicon = "AMD";
			break;
		case vendor_type::centaur:
			silicon = "Centaur";
			break;
		case vendor_type::cyrix:
			silicon = "Cyrix";
			break;
		case vendor_type::intel:
			silicon = "Intel";
			break;
		case vendor_type::transmeta:
			silicon = "Transmeta";
			break;
		case vendor_type::nat_semi:
			silicon = "National Semiconductor";
			break;
		case vendor_type::nexgen:
			silicon = "NexGen";
			break;
		case vendor_type::rise:
			silicon = "Rise";
			break;
		case vendor_type::sis:
			silicon = "SiS";
			break;
		case vendor_type::umc:
			silicon = "UMC";
			break;
		case vendor_type::via:
			silicon = "VIA";
			break;
		case vendor_type::vortex:
			silicon = "Vortex";
			break;
		default:
			silicon = "Unknown";
			break;
		}

		switch(vendor & vendor_type::any_hypervisor) {
		case vendor_type::bhyve:
			hypervisor = "bhyve";
			break;
		case vendor_type::kvm:
			hypervisor = "KVM";
			break;
		case vendor_type::hyper_v:
			hypervisor = "Hyper-V";
			break;
		case vendor_type::parallels:
			hypervisor = "Parallels";
			break;
		case vendor_type::vmware:
			hypervisor = "VMware";
			break;
		case vendor_type::xen_hvm:
			hypervisor = "Xen HVM";
			break;
		case vendor_type::xen_viridian:
			hypervisor = "Xen HVM with Viridian Extensions";
			break;
		case vendor_type::qemu:
			hypervisor = "QEMU";
			break;
		default:
			hypervisor = "";
		}

		return hypervisor.size() != 0 ? hypervisor + " on " + silicon : silicon;
	}

	using register_set_t = std::array<std::uint32_t, 4>;
	using subleaves_t    = std::map<subleaf_type, register_set_t>;
	using leaves_t       = std::map<leaf_type, subleaves_t>;

	vendor_type get_vendor_from_name(const register_set_t& regs);

	struct id_info_t
	{
		std::uint32_t brand_id                : 8;
		std::uint32_t cache_line_size         : 8;
		std::uint32_t maximum_addressable_ids : 8;
		std::uint32_t initial_apic_id         : 8;
	};

	struct split_model_t
	{
		std::uint32_t stepping        : 4;
		std::uint32_t model           : 4;
		std::uint32_t family          : 4;
		std::uint32_t type            : 2;
		std::uint32_t reserved_1      : 2;
		std::uint32_t extended_model  : 4;
		std::uint32_t extended_family : 8;
		std::uint32_t reserved_2      : 4;
	};

	struct model_t
	{
		std::uint32_t stepping;
		std::uint32_t model;
		std::uint32_t family;
	};

	inline bool operator==(const model_t& lhs, const model_t& rhs) noexcept {
		return lhs.stepping == rhs.stepping
		    && lhs.model    == rhs.model
		    && lhs.family   == rhs.family;
	}

	struct cpu_t
	{
		std::uint32_t apic_id;
		vendor_type vendor;
		model_t model;
		leaves_t leaves;
	};

	inline bool operator==(const cpu_t& lhs, const cpu_t& rhs) noexcept {
		return lhs.apic_id == rhs.apic_id
		    && lhs.vendor  == rhs.vendor
		    && lhs.model   == rhs.model
		    && lhs.leaves  == rhs.leaves;
	}

	register_set_t cpuid(leaf_type leaf, subleaf_type subleaf) noexcept;

	void print_generic(fmt::memory_buffer& out, const cpu_t& cpu, leaf_type leaf, subleaf_type subleaf);

	enum struct file_format
	{
		native,
		etallen,
		libcpuid,
		aida64,
		cpuinfo
	};

	std::map<std::uint32_t, cpu_t> enumerate_file(std::istream& fin, file_format format);
	std::map<std::uint32_t, cpu_t> enumerate_processors(bool brute_force, bool skip_vendor_check, bool skip_feature_check);

	void print_dump(fmt::memory_buffer& out, std::map<std::uint32_t, cpu_t> logical_cpus, file_format format);
	void print_leaf(fmt::memory_buffer& out, const cpu_t& cpu, leaf_type leaf, bool skip_vendor_check, bool skip_feature_check);
	void print_leaves(fmt::memory_buffer& out, const cpu_t& cpu, bool skip_vendor_check, bool skip_feature_check);

	struct flag_spec_t
	{
		std::uint32_t selector_eax  = 0_u32;
		std::uint32_t selector_ecx  = 0_u32;
		register_type flag_register = eax;
		std::string   flag_name     = "";
		std::uint32_t flag_start    = 0xffff'ffff_u32;
		std::uint32_t flag_end      = 0xffff'ffff_u32;
	};

	void print_single_flag(fmt::memory_buffer& out, const cpu_t& cpu, const flag_spec_t& flag_description);
	flag_spec_t parse_flag_spec(const std::string& flag_description);
	std::string to_string(const flag_spec_t& spec);

	inline bool operator==(const flag_spec_t& lhs, const flag_spec_t& rhs) noexcept {
		return std::tie(lhs.selector_eax, lhs.selector_ecx, lhs.flag_register, lhs.flag_name, lhs.flag_start, lhs.flag_end)
		    == std::tie(rhs.selector_eax, rhs.selector_ecx, rhs.flag_register, rhs.flag_name, rhs.flag_start, rhs.flag_end);
	}

	struct cache_instance_t
	{
		std::vector<std::uint32_t> sharing_ids;
	};

	struct cache_t
	{
		std::uint32_t level;
		std::uint32_t type;
		std::uint32_t ways;
		std::uint32_t sets;
		std::uint32_t line_size;
		std::uint32_t line_partitions;
		std::uint32_t total_size;
		bool fully_associative;
		bool direct_mapped;
		bool complex_addressed;
		bool self_initializing;
		bool invalidates_lower_levels;
		bool inclusive;
		std::uint32_t sharing_mask;

		std::map<std::uint32_t, cache_instance_t> instances;
	};

	inline bool operator<(const cache_t& lhs, const cache_t& rhs) noexcept {
		return lhs.level != rhs.level ? lhs.level      < rhs.level
			 : lhs.type  != rhs.type  ? lhs.type       < rhs.type
			 :                          lhs.total_size < rhs.total_size;
	}

	enum class level_type : std::uint32_t
	{
		invalid =           0_u32,
		smt     =           1_u32,
		core    =           2_u32,
		module  =           3_u32,
		tile    =           4_u32,
		die     =           5_u32,
		node    = 0xffff'fffe_u32,
		package = 0xffff'ffff_u32
	};

	struct level_description_t
	{
		level_type level;
		std::uint32_t shift_distance;
		std::uint32_t select_mask;
	};

	struct logical_core_t
	{
		std::uint32_t full_apic_id;

		std::uint32_t smt_id;
		std::uint32_t core_id;
		std::uint32_t package_id;

		std::vector<std::uint32_t> non_shared_cache_ids;
		std::vector<std::uint32_t> shared_cache_ids;
	};

	struct physical_core_t
	{
		std::map<std::uint32_t, logical_core_t> logical_cores;
	};

	struct module_t
	{
		std::map<std::uint32_t, physical_core_t> physical_cores;
	};

	struct tile_t
	{
		std::map<std::uint32_t, module_t> modules;
	};

	struct die_t
	{
		std::map<std::uint32_t, tile_t> tiles;
	};

	struct node_t
	{
		std::map<std::uint32_t, physical_core_t> physical_cores;
	};

	struct package_t
	{
		std::map<std::uint32_t, physical_core_t> physical_cores;

		//std::map<std::uint32_t, die_t> dies;
		//std::map<std::uint32_t, node_t> nodes;
	};

	struct system_t
	{
		vendor_type vendor;

		std::uint32_t smt_mask_width;
		std::uint32_t core_mask_width;
		std::uint32_t module_mask_width;
		std::uint32_t tile_mask_width;
		std::uint32_t die_mask_width;
		std::vector<std::uint32_t> x2_apic_ids;

		std::vector<cache_t> all_caches;
		std::vector<logical_core_t> all_cores;

		std::map<std::uint32_t, package_t> packages;

		std::set<level_type> valid_levels;
	};

	system_t build_topology(const std::map<std::uint32_t, cpu_t>& logical_cpus);

	void print_topology(fmt::memory_buffer& out, const system_t& machine);

	}

#endif
