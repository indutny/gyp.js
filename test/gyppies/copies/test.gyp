{
  "targets": [{
    "target_name": "ohai",
    "type": "executable",
    "sources": [
      "main.c",
    ],
  }, {
    "target_name": "copy_ohai",
    "type": "none",
    "copies": [{
      "destination": "out/",
      "files": [
        "<(PRODUCT_DIR)/ohai<(EXECUTABLE_SUFFIX)",
      ],
    }],
  }],
}
