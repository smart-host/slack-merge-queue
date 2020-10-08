const core = require('@actions/core');
const github = require('@actions/github');
const { WebClient } = require('@slack/web-api');

const { setActionStatus } = require('./helpers');
const modes = require('./modes');
const { STATUS } = require('./consts');

const token = process.env.SLACK_TOKEN;
const client = new WebClient(token);

(async function main() {
  const modeName = core.getInput('mode');
  const channel = core.getInput('channel');
  const { payload, ...actionContext } = github.context;

  const mode = modes[modeName];

  core.info(`mode: ${modeName}\n`);

  if (!mode) {
    setActionStatus(STATUS.FAILED);
    return core.setFailed('mode not recognised');
  }
  if (!channel) {
    setActionStatus(STATUS.FAILED);
    return core.setFailed('channel id must be specified');
  }

  try {
    await mode({ client, payload, channel, actionContext });
  } catch (error) {
    setActionStatus(STATUS.FAILED);
    core.error(error.message);
    core.debug(error);
  }
})();
