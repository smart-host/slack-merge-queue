const core = require('@actions/core');
const get = require('lodash/get');
const findLast = require('lodash/findLast');

const {
  setActionStatus,
  parseTag,
  getWatchers,
  getHistory,
} = require('../helpers');
const { STATUS, Q_STATUS } = require('../consts');

async function alert({ client, payload: orgPayload }) {
  let issueNumber = get(orgPayload, 'pull_request.number');
  const onlyWhenCurrent =
    core.getInput('only_when_current').toLowerCase() === 'true';

  if (get(orgPayload, 'workflow_run')) {
    issueNumber = get(orgPayload, 'workflow_run.pull_requests[0].number');
  }
  const payload = {
    ...orgPayload,
    issueNumber,
  };
  const { messages = [] } = await getHistory({
    channel: core.getInput('channel'),
    client,
  });

  const matches = messages.filter(({ text }) => {
    const { mergeStatus } = parseTag(text);
    return mergeStatus === Q_STATUS.MERGING;
  });

  const highestPriorityIndex = matches.length - 1;
  core.info(`Queue size: ${matches.length}`);
  core.info(`Highest priority index: ${highestPriorityIndex} `);

  const match = findLast(matches, (message, i) => {
    const { text } = message;
    const { issueNumber: num } = parseTag(text);
    const isCurrentPR = num.trim() === issueNumber.toString();
    const shouldAlert =
      !onlyWhenCurrent || (onlyWhenCurrent && i === highestPriorityIndex);
    if (isCurrentPR) {
      core.info(`current index: ${i}`);
    }
    return shouldAlert && isCurrentPR;
  });

  if (!match) {
    core.info(`Could not find pull request in queue or did not satify filters`);
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
