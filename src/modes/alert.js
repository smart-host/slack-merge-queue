const core = require('@actions/core');
const get = require('lodash/get');

const { setActionStatus, parseTag, findPrInQueue } = require('../helpers');
const { STATUS, Q_STATUS } = require('../consts');

async function alert({ client, payload: orgPayload }) {
  const issueNumber = get(orgPayload, 'pull_request.number');
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

  await client.chat.postMessage({
    thread_ts: match.ts,
    mrkdwn: true,
    text: core.getInput('alert_message'),
    channel: match.channel.id,
  });

  return setActionStatus(STATUS.COMPLETED);
}

module.exports = alert;
