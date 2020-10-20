const core = require('@actions/core');
const get = require('lodash/get');

const {
  setActionStatus,
  buildTagFromParse,
  parseTag,
  getHistory,
  organizeHistory,
  getFormattedComment,
  getWatchers,
} = require('../helpers');
const { STATUS, Q_STATUS } = require('../consts');

async function cancel({ client, payload: orgPayload, channel, chatOptions }) {
  const issueNumber = get(orgPayload, 'issue.number');
  const payload = {
    ...orgPayload,
    issueNumber,
  };

  const trigger = core.getInput('cancel_trigger');
  const state = get(payload, 'issue.state');
  const commentArr = getFormattedComment({ payload });

  core.info(`comment:\n ${JSON.stringify(commentArr)}\n`);

  if (state !== 'open') {
    core.info('PR already closed');
    return setActionStatus(STATUS.ALREADY_CLOSED);
  }

  if (!commentArr.find((x) => x.trim().startsWith(trigger))) {
    core.info(`Trigger (${trigger}) not found.`);
    return setActionStatus(STATUS.TRIGGER_NOT_FOUND);
  }

  const { messages = [] } = await getHistory({
    channel,
    client,
  });

  const { nextPr, current: match } = organizeHistory({
    messages,
    issueNumber,
  });

  if (!match) {
    core.info(`PR not in queue. nothing to cancel`);
    return setActionStatus(STATUS.NOT_FOUND);
  }

  const tagSections = parseTag(match.text);
  const newTag = buildTagFromParse({
    ...tagSections,
    mergeStatus: Q_STATUS.CANCELLED,
  });

  await client.chat.update({
    ...chatOptions,
    ts: match.ts,
    text: newTag,
    channel: channel.id,
    attachments: match.attachments,
  });

  setActionStatus(Q_STATUS.CANCELLED);

  if (nextPr) {
    core.info(`next PR: \n${JSON.stringify(nextPr, null, 2)}`);

    const { issueNumber: nextPrNum } = parseTag(nextPr.text);
    core.setOutput('next_pr', nextPrNum);
    const watchers = getWatchers(nextPr);

    const alertMsg = core.getInput('cancel_ready_message');
    const alertText = `${alertMsg}${watchers}`;

    await client.chat.postMessage({
      ...chatOptions,
      thread_ts: nextPr.ts,
      mrkdwn: true,
      text: alertText,
      channel: channel.id,
    });
  }
}

module.exports = cancel;