const core = require('@actions/core');
const get = require('lodash/get');
const findLastIndex = require('lodash/findLastIndex');
const takeWhile = require('lodash/takeWhile');
const takeRightWhile = require('lodash/takeRightWhile');
const takeRight = require('lodash/takeRight');

const {
  setActionStatus,
  buildTag,
  buildTagFromParse,
  parseTag,
  getHistory,
  getWatchers,
} = require('../helpers');
const { STATUS, Q_STATUS } = require('../consts');

async function merge({ client, payload: orgPayload, channel }) {
  const issueNumber = get(orgPayload, 'pull_request.number');
  const payload = {
    ...orgPayload,
    issueNumber,
  };
  const isMerged = get(payload, 'pull_request.merged');

  const { messages = [] } = await getHistory({
    channel,
    client,
  });

  const matchIndex = findLastIndex(messages, (message) => {
    const { text } = message;
    const { issueNumber: num, mergeStatus } = parseTag(text);
    const isCurrentPR = num.trim() === (issueNumber || '').toString();
    return isCurrentPR && mergeStatus === Q_STATUS.MERGING;
  });

  const match = messages[matchIndex];

  const commonTagProps = {
    issueNumber,
    title: get(payload, 'pull_request.title'),
    url: get(payload, 'pull_request.html_url'),
  };

  if (!match) {
    core.info(
      `Could not find pull request with status['${Q_STATUS.MERGING}'] in queue`,
    );
    return setActionStatus(STATUS.NOT_FOUND);
  }

  core.info(`found message: \n${JSON.stringify(match, null, 2)}`);

  let tag = buildTag({
    ...commonTagProps,
    status: Q_STATUS.MERGED,
  });

  if (!isMerged) {
    tag = buildTag({
      ...commonTagProps,
      status: Q_STATUS.CANCELLED,
    });
    core.warning('Pull request is not merged, will cancel in the queue');
    core.info(tag);

    setActionStatus(Q_STATUS.CANCELLED);
  } else {
    core.info(`Pull request merged!\n ${tag}`);
    setActionStatus(Q_STATUS.MERGED);
  }

  await client.chat.update({
    ts: match.ts,
    text: tag,
    channel: channel.id,
    icon_emoji: core.getInput('icon_emoji'),
    icon_url: core.getInput('icon_url'),
  });

  const mergingFilter = ({ text }) => {
    if (!text) {
      return false;
    }
    const { mergeStatus } = parseTag(text);
    return mergeStatus === Q_STATUS.MERGING;
  };

  const newer = takeWhile(messages, (_, i) => i < matchIndex).filter(
    mergingFilter,
  );
  const older = takeRightWhile(messages, (_, i) => i > matchIndex).filter(
    mergingFilter,
  );

  // alert next in queue
  const nextPr = takeRight(newer)[0];

  if (nextPr) {
    core.info(`next PR: \n${JSON.stringify(nextPr, null, 2)}`);

    const { issueNumber: nextPrNum } = parseTag(nextPr.text);
    core.setOutput('next_pr', nextPrNum);
    const watchers = getWatchers(nextPr);

    const alertMsg = core.getInput('merge_ready_message');
    const alertText = `${alertMsg}${watchers}`;

    await client.chat.postMessage({
      thread_ts: nextPr.ts,
      mrkdwn: true,
      text: alertText,
      channel: channel.id,
      icon_emoji: core.getInput('icon_emoji'),
      icon_url: core.getInput('icon_url'),
    });
  }

  if (isMerged) {
    const promises = older.map(async (msg) => {
      const { text } = msg;
      const tagSections = parseTag(text);
      const newTag = buildTagFromParse({
        ...tagSections,
        mergeStatus: Q_STATUS.STALE,
      });

      await client.chat.update({
        ts: msg.ts,
        text: newTag,
        channel: channel.id,
        icon_emoji: core.getInput('icon_emoji'),
        icon_url: core.getInput('icon_url'),
      });
    });

    await Promise.all(promises);
  }
}

module.exports = merge;
