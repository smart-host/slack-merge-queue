const core = require('@actions/core');
const get = require('lodash/get');

const {
  setActionStatus,
  buildTag,
  parseTag,
  findPrInQueue,
  findNextWithMergingStatus,
  getWatchers,
} = require('../helpers');
const { STATUS, Q_STATUS } = require('../consts');

async function merge({ client, payload: orgPayload }) {
  const issueNumber = get(orgPayload, 'pull_request.number');
  const payload = {
    ...orgPayload,
    issueNumber,
  };
  const isMerged = get(payload, 'pull_request.merged');
  const match = await findPrInQueue({
    payload,
    client,
    filter: ({ text }) => {
      const { mergeStatus } = parseTag(text);
      return mergeStatus === Q_STATUS.MERGING;
    },
  });
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
    channel: match.channel.id,
  });

  // alert next in queue
  const nextPr = await findNextWithMergingStatus({ client, payload });

  if (!nextPr) {
    return null;
  }

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
    channel: nextPr.channel.id,
  });
}

module.exports = merge;
