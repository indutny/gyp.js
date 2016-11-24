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
COVERAGEDIR=./coverage

lint:
	@$(BINDIR)/eslint $(SRC_FILES)

format:
	@$(BINDIR)/eslint --fix $(SRC_FILES)

check:
	@$(BINDIR)/mocha --reporter=spec test/*-test.js

coverage:
	@-rm -rf $(COVERAGEDIR)
	@$(BINDIR)/istanbul cover --report none --print none --include-pid \
		$(BINDIR)/_mocha -- -u exports -R spec test/*-test.js
	@$(BINDIR)/istanbul report text-summary lcov

test: check

.PHONY: lint format check test coverage
