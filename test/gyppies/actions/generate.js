'use strict';

const output = process.argv[3];

require('fs').writeFileSync(output, 'int main() { return 0; }');
