{
  "target_defaults": {
    "make_global_settings": [
      [ "CC", "echo" ],
      [ "LD", "echo" ],
    ],
  },

  "targets": [{
    "target_name": "test",
    "type": "executable",
    "sources": [
      "main.c",
    ],
  }],
}
