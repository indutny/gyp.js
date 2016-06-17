SRC_FILES=
SRC_FILES+= lib/*.js
SRC_FILES+= lib/**/*.js
SRC_FILES+= lib/**/**/*.js
SRC_FILES+= lib/**/**/**/*.js

SRC_FILES+= bin/gyp
SRC_FILES+= test/*.js

lint:
	eslint $(SRC_FILES)

format:
	eslint --fix $(SRC_FILES)

.PHONY: lint format
