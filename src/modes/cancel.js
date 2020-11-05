const core = require('@actions/core');
const get = require('lodash/get');
const size = require('lodash/size');

const {
  setActionStatus,
  buildTagFromParse,
  parseTag,
  getHistory,
  organizeHistory,
  getFormattedComment,
  getWatchers,
  deleteThread,
  buildAlertMessage,
  selectBoolString,
  getCommentTaggedValue,
} = require('../helpers');
const { STATUS, Q_STATUS, ATTACH_PREFIX } = require('../consts');

async function cancel({ client, payload: orgPayload, channel, chatOptions }) {
  const issueNumber = get(orgPayload, 'issue.number') || get(orgPayload, 'pull_request.number');
  const payload = {
    ...orgPayload,
    issueNumber,
  };

  const trigger = core.getInput('cancel_trigger');
  const state = get(payload, 'issue.state') || get(orgPayload, 'pull_request.state');
  const commentArr = getFormattedComment({ payload });
  const selectedDeleteOnCancel = selectBoolString({
    default: 'false',
    values: [
      getCommentTaggedValue({
        commentArr,
        tag: ATTACH_PREFIX.DELETE_ON_CANCEL,
      }),
      core.getInput('delete_on_cancel'),
    ],
  });
  const deleteOnCancel = selectedDeleteOnCancel === 'true';

  core.info(`comment:\n ${JSON.stringify(commentArr)}\n`);

  if (state !== 'open') {
    core.info('PR already closed');
    core.setOutput('triggered', 'false');
    return setActionStatus(STATUS.ALREADY_CLOSED);
  }

  if (!commentArr.find((x) => x.trim().startsWith(trigger))) {
    core.info(`Trigger (${trigger}) not found.`);
    core.setOutput('triggered', 'false');
    return setActionStatus(STATUS.TRIGGER_NOT_FOUND);
  }

  core.setOutput('triggered', 'true');

  const { messages = [] } = await getHistory({
    channel,
    client,
  });

  const { older, nextPr, current: match } = organizeHistory({
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

  const isNextPrReady = nextPr && size(older) < 1;

  core.info(`is next PR up for merge?: ${isNextPrReady}`);

  if (isNextPrReady) {
    core.info(`next PR: \n${JSON.stringify(nextPr, null, 2)}`);

    const { issueNumber: nextPrNum } = parseTag(nextPr.text);
    core.setOutput('next_pr', nextPrNum);
    const watchers = getWatchers(nextPr);

    const alertMsg = core.getInput('cancel_ready_message');
    const alertText = buildAlertMessage({ text: alertMsg, watchers });

    await client.chat.postMessage({
      ...chatOptions,
      thread_ts: nextPr.ts,
      mrkdwn: true,
      text: alertText,
      channel: channel.id,
    });
  }

  if (deleteOnCancel) {
    await deleteThread({ client, channel, message: match });
  }
}

module.exports = cancel;
