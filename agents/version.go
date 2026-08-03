package main

// BuildVersion is injected by release build scripts. Local ad-hoc builds are
// intentionally marked as dev so they cannot be mistaken for a release.
var BuildVersion = "dev"

// BuildChannel is injected by release build scripts. Test is the safe default
// for local and prerelease builds.
var BuildChannel = "test"
