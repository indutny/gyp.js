{
  "targets": [{
    "target_name": "test",
    "type": "executable",
    "dependencies": [
      "action",
    ],
    "sources": [
      "<(SHARED_INTERMEDIATE_DIR)/src/main.c",
    ],
  }, {
    "target_name": "action",
    "type": "none",
    "actions": [{
      "action_name": "source2blob",
      "inputs": [
        "test.gyp",
      ],
      "outputs": [
        "<(SHARED_INTERMEDIATE_DIR)/src/main.c",
      ],
      "action": [
        "node",
        "generate.js",
        "<@(_inputs)",
        "<@(_outputs)",
      ],
    }],
  }],
}
