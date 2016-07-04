{
  "targets": [{
    "target_name": "dep",

    # NOTE: Should be executed with cwd=dep/
    "type": "<!(node gen.js)",

    "sources": [
      "dep.c",
    ],
  }],
}
