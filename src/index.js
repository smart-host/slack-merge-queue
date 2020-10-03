const core = require('@actions/core');
const { WebClient } = require('@slack/web-api');

const { setActionStatus } = require('./helpers');
const modes = require('./modes');
const { STATUS } = require('./consts');

const token = process.env.SLACK_TOKEN;
const client = new WebClient(token);

(async function main() {
  const modeName = core.getInput('mode');
  const mode = modes[modeName];

  if (!mode) {
    setActionStatus(STATUS.FAILURE);
    return core.setFailed('mode not recognised');
  }

  await mode({ client });
})();
