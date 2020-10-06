const core = require('@actions/core');
const get = require('lodash/get');

const {
  setActionStatus,
  parseTag,
  findPrInQueue,
  getWatchers,
} = require('../helpers');
const { STATUS, Q_STATUS } = require('../consts');

async function alert({ client, payload: orgPayload }) {
  let issueNumber = get(orgPayload, 'pull_request.number');

  if (get(orgPayload, 'workflow_run')) {
    issueNumber = get(orgPayload, 'workflow_run.pull_requests[0].number');
  }
  core.info(`${JSON.stringify(orgPayload, null, 2)}`);

  if (get(orgPayload, 'check_suite')) {
    core.info(`${JSON.stringify(orgPayload, null, 2)}`);
  }

  const payload = {
    ...orgPayload,
    issueNumber,
  };
  const match = await findPrInQueue({
    payload,
    client,
    filter: ({ text }) => {
      const { mergeStatus } = parseTag(text);
      return mergeStatus === Q_STATUS.MERGING;
    },
  });

  if (!match) {
    core.info(
      `Could not find pull request with status['${Q_STATUS.MERGING}'] in queue`,
    );
    return setActionStatus(STATUS.NOT_FOUND);
  }

  core.info(`found PR in queue, sending alert in thread`);
  core.debug(`${JSON.stringify(match, null, 2)}`);
  let watchers = getWatchers(match);

  const alertMsg = core.getInput('alert_message');
  const alertText = `${alertMsg}${watchers}`;

  await client.chat.postMessage({
    thread_ts: match.ts,
    mrkdwn: true,
    text: alertText,
    channel: core.getInput('channel'),
    icon_emoji: core.getInput('icon_emoji'),
    icon_url: core.getInput('icon_url'),
  });

  return setActionStatus(STATUS.COMPLETED);
}

module.exports = alert;
