SRC_FILES=
SRC_FILES+= lib/*.js
SRC_FILES+= lib/**/*.js
SRC_FILES+= lib/**/**/*.js
SRC_FILES+= lib/**/**/**/*.js

SRC_FILES+= bin/gyp
SRC_FILES+= test/*.js
SRC_FILES+= test/**/*.js
SRC_FILES+= test/**/**/*.js

lint:
	@node_modules/.bin/eslint $(SRC_FILES)

format:
	@node_modules/.bin/eslint --fix $(SRC_FILES)

check:
	@node_modules/.bin/mocha --reporter=spec test/*-test.js

test: check

.PHONY: lint format check test
