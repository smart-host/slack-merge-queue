const core = require('@actions/core');
const get = require('lodash/get');

const {
  setActionStatus,
  parseTag,
  getWatchers,
  getHistory,
} = require('../helpers');
const { STATUS, Q_STATUS } = require('../consts');

async function alert({ client, payload: orgPayload, channel, chatOptions }) {
  const issueNumbers = [get(orgPayload, 'pull_request.number').toString()];
  const onlyWhenCurrent =
    core.getInput('only_when_current').toLowerCase() === 'true';

  if (get(orgPayload, 'workflow_run')) {
    get(orgPayload, 'workflow_run.pull_requests', []).forEach(({ number }) => {
      if (issueNumbers.includes(number.toString())) {
        return null;
      }
      issueNumbers.push(number.toString());
    });
  }
  const { messages = [] } = await getHistory({
    channel,
    client,
  });

  let messagesToAlert = [];
  const matches = messages.filter(({ text }) => {
    const { mergeStatus } = parseTag(text);
    return mergeStatus === Q_STATUS.MERGING;
  });

  const highestPriorityIndex = matches.length - 1;
  const filteredIssues = issueNumbers.filter(Boolean);
  core.info(`Queue size: ${matches.length}`);
  core.info(`Highest priority index: ${highestPriorityIndex} \n`);

  if (onlyWhenCurrent) {
    messagesToAlert = [matches[highestPriorityIndex]];
  } else {
    messagesToAlert = [...matches];
  }

  core.info(`issues: ${JSON.stringify(filteredIssues, null, 2)}`);

  const promises = messagesToAlert.map(async (match) => {
    const { text } = match;
    const { issueNumber: num } = parseTag(text);
    const prTag = `PR${num}: `;

    if (!filteredIssues.includes(num.toString())) {
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

    const result = await client.chat.postMessage({
      ...chatOptions,
      thread_ts: match.ts,
      mrkdwn: true,
      text: alertText,
      channel: channel.id,
    });
    return result;
  });

  await Promise.all(promises);

  return setActionStatus(STATUS.COMPLETED);
}

module.exports = alert;
