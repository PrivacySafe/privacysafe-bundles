/**
 This file finishes "booting" Jasmine, performing all of the necessary
 initialization before executing the loaded environment and all of a project's
 specs. This file should be loaded after `boot0.js` but before any project
 source files or spec files are loaded. Thus this file can also be used to
 customize Jasmine for a project.

 If a project is using Jasmine via the standalone distribution, this file can
 be customized directly. If you only wish to configure the Jasmine env, you
 can load another file that calls `jasmine.getEnv().configure({...})`
 after `boot0.js` is loaded and before this file is loaded.
 */

(function() {
  var env = jasmine.getEnv();

  /**
   * ## Runner Parameters
   *
   * More browser specific code - wrap the query string in an object and to allow for getting/setting parameters from the runner user interface.
   */

  var queryString = new jasmine.QueryString({
    getWindowLocation: function() { return window.location; }
  });

  var filterSpecs = !!queryString.getParam("spec");

  var config = {
    failFast: queryString.getParam("failFast"),
    oneFailurePerSpec: queryString.getParam("oneFailurePerSpec"),
    hideDisabled: queryString.getParam("hideDisabled")
  };

  var random = queryString.getParam("random");

  if (random !== undefined && random !== "") {
    config.random = random;
  } else {
    // we make default to non-random order
    config.random = false;
  }

  var seed = queryString.getParam("seed");
  if (seed) {
    config.seed = seed;
  }

  /**
   * ## Reporters
   * The `HtmlReporter` builds all of the HTML UI for the runner page. This reporter paints the dots, stars, and x's for specs, as well as all spec names and all failures (if any).
   */
  var htmlReporter = new jasmine.HtmlReporter({
    env: env,
    navigateWithNewParam: function(key, value) { return queryString.navigateWithNewParam(key, value); },
    addToExistingQueryString: function(key, value) { return queryString.fullStringWithNewParam(key, value); },
    getContainer: function() { return document.body; },
    createElement: function() { return document.createElement.apply(document, arguments); },
    createTextNode: function() { return document.createTextNode.apply(document, arguments); },
    timer: new jasmine.Timer(),
    filterSpecs: filterSpecs
  });

  /**
   * The `jsApiReporter` also receives spec results, and is used by any environment that needs to extract the results  from JavaScript.
   */
  env.addReporter(jsApiReporter);
  env.addReporter(htmlReporter);

  // we add completion reporter that dumps info to log for external tools' use,
  // and close platform after tests, if needed.
  const specsCounts = {
    pass: 0,
    fail: 0,
    pending: 0,
    skipped: 0,
    suiteFails: 0,
  };
  env.addReporter({
    jasmineStarted: () => {
      specsCounts.pass = 0;
      specsCounts.fail = 0;
      specsCounts.pending = 0;
      w3n.testStand.record('tests-start');
    },
    specDone: async (result) => {
      if (result.status == 'passed') {
        specsCounts.pass += 1;
        w3n.testStand.record('spec-pass', result.fullName);
      } else if (result.status == 'pending') {
        specsCounts.pending += 1;
        w3n.testStand.record('spec-pending', result.fullName);
      } else if (result.status == 'excluded') {
        specsCounts.skipped += 1;
      } else {
        specsCounts.fail += 1;
        w3n.testStand.record('spec-fail', result.fullName +
          '\n' + JSON.stringify(
            result,
            (k, v) => ((k == 'passedExpectations') ? undefined : v),
            2));
      }
    },
    suiteDone: async (result) => {
      if (result.status == 'passed') { return; }
      specsCounts.suiteFails += 1;
      w3n.testStand.record('suite-fail', JSON.stringify(result, null, 2));
    },
		jasmineDone: async (info) => {
      const { pass, pending, skipped, fail, suiteFails } = specsCounts;
      const noSpecs = ((pass + pending + fail) === 0);
      const recType = ((info.overallStatus == 'passed') ?
        'tests-pass' : 'tests-fail');
      w3n.testStand.record(recType, (noSpecs ?
        `No specs reported. Where any setup?` :
        `${
          (skipped > 0) ? `${skipped} skipped\n` : ''}${
          (pass > 0) ? `${pass} passed\n` : ''}${
          (fail > 0) ? `${fail} failed\n` : ''}${
          (pending > 0) ? `${pending} pending\n` : ''}${
          (suiteFails > 0) ? `${suiteFails} non-ok test suites\n` : ''}`));
      const closing = window.closeW3NAfterTests;
      if (closing) {
        const coolDownSecs = (closing.waitSecs ? closing.waitSecs : 5);
        setTimeout(() => {
          if (closeW3NAfterTests) {
            w3n.testStand.exitAll();
          }
        }, coolDownSecs*1000);
      }
    }
	});

  /**
   * Filter which specs will be run by matching the start of the full name against the `spec` query param.
   */
  var specFilter = new jasmine.HtmlSpecFilter({
    filterString: function() { return queryString.getParam("spec"); }
  });

  config.specFilter = function(spec) {
    return specFilter.matches(spec.getFullName());
  };

  env.configure(config);

  /**
   * Setting up timing functions to be able to be overridden. Certain browsers (Safari, IE 8, phantomjs) require this hack.
   */
  window.setTimeout = window.setTimeout;
  window.setInterval = window.setInterval;
  window.clearTimeout = window.clearTimeout;
  window.clearInterval = window.clearInterval;

  /**
   * ## Execution
   *
   * Replace the browser window's `onload`, ensure it's called, and then run all of the loaded specs. This includes initializing the `HtmlReporter` instance and then executing the loaded Jasmine environment. All of this will happen after all of the specs are loaded.
   */
  var currentWindowOnload = window.onload;

  /**
   * Setup of this window failed, so not a single spec can run here.
   *
   * Without this the failure is invisible from the outside: nothing is recorded,
   * the stand never sees 'tests-start', and its verdict reads "the tests never
   * began" as success - a run in which nothing at all executed exits with 0.
   * That is how a broken run went unnoticed on 2026-08-14, three windows in a
   * row, while the reports said the tests had passed.
   */
  async function reportSetupFailure(err) {
    // Own property names, and a fallback to String(): a plain JSON.stringify of
    // an RPC exception or of an Error gives '{}', which says nothing about what
    // broke.
    let reason;
    if (typeof err === 'string') {
      reason = err;
    } else {
      try {
        reason = JSON.stringify(err, Object.getOwnPropertyNames(Object(err)), 2);
      } catch (jsonErr) {
        reason = undefined;
      }
      if (!reason || (reason === '{}')) {
        reason = String(err);
      }
    }

    // Both records are needed: 'tests-start' is what makes the stand consider
    // the run to have happened at all, and only then does a failure count.
    w3n.testStand.record('tests-start');
    w3n.testStand.record(
      'tests-fail',
      `Setup of this window failed, so no spec could run here.\n${reason}`,
    );

    const out = document.getElementById('test-out');
    if (out) {
      const p = document.createElement('p');
      p.style.color = 'red';
      p.appendChild(document.createTextNode(
        `Setup failed, no specs were run. ${reason}`,
      ));
      out.appendChild(p);
    }

    // Ending the run is the main window's business only. A secondary user is a
    // bot the specs talk to: its failure is recorded above - which is already
    // enough to make the run exit non-zero - but the specs must still run and
    // show what breaks without it. When the main window is the one that failed,
    // there is nothing left to wait for.
    try {
      const { userNum } = await w3n.testStand.staticTestInfo();
      if (userNum === 1) {
        setTimeout(() => w3n.testStand.exitAll(), 5000);
      }
    } catch (infoErr) {
      w3n.testStand.log('error', `Failed to tell which test user this window is`, infoErr);
    }
  }

  window.onload = function() {
    if (currentWindowOnload) {
      currentWindowOnload();
    }
    // wait to allow load that may require to skip tests
    setTimeout(async () => {
      if (window.preTestProc) {
        try {
          await window.preTestProc;
        } catch (err) {
          await reportSetupFailure(err);
          return;
        }
      }
      if (window.skipW3NTests) { return; }
      htmlReporter.initialize();
      env.execute();
    }, 1000);
  };

  /**
   * Helper function for readability above.
   */
  function extend(destination, source) {
    for (var property in source) destination[property] = source[property];
    return destination;
  }

}());
