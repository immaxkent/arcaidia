// Hand-trimmed after `substreams protogen`: the generator's --include-imports
// pulls in the whole sf.substreams.* protocol surface, which a plain `map`
// module never touches. Kept to just our own schema, plus the vendored
// entity-change schema graph_out depends on — see that .proto file's own
// header for why it's vendored rather than pulled in via a crate.
pub mod erc4626 {
    pub mod v1 {
        include!("erc4626.v1.rs");
    }
}
pub mod sf {
    pub mod substreams {
        pub mod sink {
            pub mod entity {
                pub mod v1 {
                    include!("sf.substreams.sink.entity.v1.rs");
                }
            }
        }
    }
}
