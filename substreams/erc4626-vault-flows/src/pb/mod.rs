// Hand-trimmed after `substreams protogen`: the generator's --include-imports
// pulls in the whole sf.substreams.* protocol surface, which a plain `map`
// module never touches. Kept to just our own schema so the crate's compile
// surface — and what a reader has to trust — matches what this module
// actually does.
pub mod erc4626 {
    pub mod v1 {
        include!("erc4626.v1.rs");
    }
}
