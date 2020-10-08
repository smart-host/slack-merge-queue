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

async function alert({ client, payload: orgPayload, channel }) {
  const issueNumbers = [get(orgPayload, 'pull_request.number')];
  const onlyWhenCurrent =
    core.getInput('only_when_current').toLowerCase() === 'true';

  if (get(orgPayload, 'workflow_run')) {
    get(orgPayload, 'workflow_run.pull_requests', []).forEach(({ number }) => {
      if (issueNumbers.includes(number)) {
        return null;
      }
      issueNumbers.push(number);
    });
  }
  const { messages = [] } = await getHistory({
    channel,
    client,
  });

  const matches = messages.filter(({ text }) => {
    const { mergeStatus } = parseTag(text);
    return mergeStatus === Q_STATUS.MERGING;
  });

  const highestPriorityIndex = matches.length - 1;
  core.info(`Queue size: ${matches.length}`);
  core.info(`Highest priority index: ${highestPriorityIndex} \n`);

  const promises = issueNumbers.filter(Boolean).map(async (issueNumber) => {
    const prTag = `PR${issueNumber}: `;
    const match = findLast(matches, (message, i) => {
      const { text } = message;
      const { issueNumber: num } = parseTag(text);
      const isCurrentPR = num.trim() === (issueNumber || '').toString();
      const shouldAlert =
        !onlyWhenCurrent || (onlyWhenCurrent && i === highestPriorityIndex);
      if (isCurrentPR) {
        core.info(`${prTag}index is ${i}`);
      }
      return shouldAlert && isCurrentPR;
    });

    if (!match) {
      core.info(
        `${prTag}Could not find pull request in queue or did not satisfy filters`,
      );
      return setActionStatus(STATUS.NOT_FOUND);
    }

    core.info(`${prTag}found PR in queue, sending alert in thread`);
    core.debug(`${JSON.stringify(match, null, 2)}`);
    let watchers = getWatchers(match);

    const alertMsg = core.getInput('alert_message');
    const alertText = `${alertMsg}${watchers}`;

    await client.chat.postMessage({
      thread_ts: match.ts,
      mrkdwn: true,
      text: alertText,
      channel: channel.id,
      icon_emoji: core.getInput('icon_emoji'),
      icon_url: core.getInput('icon_url'),
    });
  });

  await Promise.all(promises);

  return setActionStatus(STATUS.COMPLETED);
}

module.exports = alert;
