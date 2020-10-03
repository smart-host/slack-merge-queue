const core = require('@actions/core');
const get = require('lodash/get');

const { getMessage, findPrInQueue, setActionStatus } = require('../helpers');
const { STATUS } = require('../consts');

async function initRole({ client, payload: orgPayload }) {
  const payload = {
    ...orgPayload,
    issueNumber: get(orgPayload, 'issue.number'),
  };
  const trigger = core.getInput('init_trigger');
  const channel = core.getInput('channel');
  const commentMsg = get(payload, 'comment.body', '');
  const state = get(payload, 'issue.state');
  const commentArr = commentMsg.split('\n').filter(Boolean);

  core.info(`comment:\n ${JSON.stringify(commentArr)}\n`);

  if (state !== 'open') {
    core.info('PR already closed');
    return setActionStatus(STATUS.ALREADY_CLOSED);
  }

  if (!commentMsg.includes(trigger)) {
    core.info('Trigger not found');
    return setActionStatus(STATUS.TRIGGER_NOT_FOUND);
  }

  const match = await findPrInQueue({ payload, client });

  if (match) {
    core.info(`PR already in queue:\n ${JSON.stringify(match, null, 2)}`);
    return setActionStatus(STATUS.ALREADY_QUEUED);
  }

  core.info(`Trigger found. adding PR to queue:\n`);
  const text = getMessage(payload);
  const result = await client.chat.postMessage({
    channel,
    text,
    mrkdwn: true,
  });
  core.info(JSON.stringify(result, null, 2));

  setActionStatus(STATUS.ADDED_TO_QUEUE);
}

module.exports = initRole;
