SRC_FILES=
SRC_FILES+= src/*.js
SRC_FILES+= src/**/*.js
SRC_FILES+= src/**/**/*.js
SRC_FILES+= src/**/**/**/*.js

SRC_FILES+= bin/gyp
SRC_FILES+= test/*.js
SRC_FILES+= test/**/*.js
SRC_FILES+= test/**/**/*.js

BINDIR=./node_modules/.bin
COVERAGEDIR=./coverage

build:
	@$(BINDIR)/babel src -d lib

build-watch:
	@$(BINDIR)/babel -w src -d lib

lint:
	@$(BINDIR)/eslint $(SRC_FILES)

format:
	@$(BINDIR)/eslint --fix $(SRC_FILES)

check:
	@$(BINDIR)/mocha --reporter=spec test/*-test.js --compilers js:babel-register

coverage:
	@-rm -rf $(COVERAGEDIR)
	@$(BINDIR)/istanbul cover --report none --print none --include-pid \
		$(BINDIR)/_mocha -- -u exports -R spec test/*-test.js
	@$(BINDIR)/istanbul report text-summary lcov

test: check

.PHONY: build build-watch lint format check test coverage
