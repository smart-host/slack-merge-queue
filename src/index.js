const core = require('@actions/core');
const github = require('@actions/github');
const { WebClient } = require('@slack/web-api');

const { setActionStatus, findChannel } = require('./helpers');
const modes = require('./modes');
const { STATUS } = require('./consts');

const token = process.env.SLACK_TOKEN;
const client = new WebClient(token);

(async function main() {
  const modeName = core.getInput('mode');
  const channelName = core.getInput('channel');
  const channelTypes = core.getInput('channel_types');
  const historyThreshold = Number(core.getInput('history_threshold')) || 10;

  const { payload, ...actionContext } = github.context;
  const channel = await findChannel({
    client,
    channelName,
    types: channelTypes,
  });

  const mode = modes[modeName];

  core.info(`mode: ${modeName}\n`);

  core.debug(`github context: \n${JSON.stringify(github.context, null, 2)}`);

  if (!mode) {
    setActionStatus(STATUS.FAILED);
    return core.setFailed(`mode must be one of: ${Object.keys(modes)}`);
  }

  if (!channel) {
    setActionStatus(STATUS.FAILED);
    return core.setFailed(`could not find channel in slack: ${channelName}`);
  }

  const chatOptions = { icon_emoji: core.getInput('icon_emoji') };

  try {
    await mode({
      client,
      payload,
      channel,
      historyThreshold,
      actionContext,
      chatOptions,
    });
  } catch (error) {
    setActionStatus(STATUS.FAILED);
    core.error(error.message);
    core.debug(error);
  }
})();
