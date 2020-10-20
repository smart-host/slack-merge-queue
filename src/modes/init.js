const core = require('@actions/core');
const get = require('lodash/get');

const {
  getMessage,
  findPrInQueue,
  setActionStatus,
  buildAttachment,
  parseTag,
  getWatchers,
  getFormattedComment,
} = require('../helpers');
const { STATUS, Q_STATUS } = require('../consts');

async function initRole({ client, payload: orgPayload, channel, chatOptions }) {
  const payload = {
    ...orgPayload,
    issueNumber: get(orgPayload, 'issue.number'),
  };
  const trigger = core.getInput('init_trigger');
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

  const match = await findPrInQueue({
    payload,
    client,
    channel,
    filter: ({ text }) => {
      if (!text) {
        return false;
      }
      const { mergeStatus } = parseTag(text);
      return mergeStatus === Q_STATUS.MERGING;
    },
  });

  const attachments =
    (await buildAttachment({
      comments: commentArr,
      client,
      channel,
    })) || [];

  const eventAction = payload.action.toLowerCase();
  const oldAttachments = get(match, 'attachments', []);
  const watchersChanged = getWatchers(match) !== getWatchers({ attachments });

  core.info(`Event action: ${eventAction}`);
  core.info(`Message exists: ${!!match}`);
  core.info(`Watchers changed: ${watchersChanged}`);
  core.debug(`Old attachments: ${JSON.stringify(oldAttachments, null, 2)}`);
  core.info(`Attachments: ${JSON.stringify(attachments, null, 2)}`);

  if (!!match && watchersChanged && eventAction === 'edited') {
    const updatedMsg = await client.chat.update({
      ...chatOptions,
      ts: match.ts,
      text: match.text,
      channel: channel.id,
      attachments,
    });

    core.debug(JSON.stringify(updatedMsg, null, 2));
    return setActionStatus(STATUS.WATCHERS_UPDATED);
  }

  if (match) {
    core.info(`PR already in queue:`);
    core.info(JSON.stringify(match, null, 2));
    return setActionStatus(STATUS.ALREADY_QUEUED);
  }

  core.info(`Trigger found. adding PR to queue:\n`);
  const text = getMessage(payload);
  const result = await client.chat.postMessage({
    ...chatOptions,
    channel: channel.id,
    text,
    mrkdwn: true,
    attachments,
  });
  core.info(JSON.stringify(result, null, 2));

  setActionStatus(STATUS.ADDED_TO_QUEUE);
}

module.exports = initRole;
