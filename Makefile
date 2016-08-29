SRC_FILES=
SRC_FILES+= lib/*.js
SRC_FILES+= lib/**/*.js
SRC_FILES+= lib/**/**/*.js
SRC_FILES+= lib/**/**/**/*.js

SRC_FILES+= bin/gyp
SRC_FILES+= test/*.js
SRC_FILES+= test/**/*.js
SRC_FILES+= test/**/**/*.js

BINDIR=./node_modules/.bin

lint:
	@$(BINDIR)/eslint $(SRC_FILES)

format:
	@$(BINDIR)/eslint --fix $(SRC_FILES)

check:
	@$(BINDIR)/mocha --reporter=spec test/*-test.js

coverage:
	@$(BINDIR)/istanbul cover --html $(BINDIR)/_mocha -- -u exports -R spec test/*-test.js

test: check

.PHONY: lint format check test coverage
