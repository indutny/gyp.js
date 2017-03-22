{
  "targets": [{
    "target_name": "test",
    "type": "executable",
    "conditions": [
      [ "GYP_ENGINE == 'gyp.js' and GYP_ENGINE_VERSION != ''", {
        "sources": [
          "main.c",
        ],
      }],
    ],
  }],
}
