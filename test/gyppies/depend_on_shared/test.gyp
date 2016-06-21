{
  "targets": [{
    "target_name": "test",
    "type": "executable",
    "dependencies": [ "shared" ],
    "sources": [
      "main.cc",
    ],
  }, {
    "target_name": "shared",
    "type": "shared_library",
    "sources": [
      "lib.cc",
    ],
  }],
}
