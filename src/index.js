const token = process.env.SLACK_TOKEN;

const core = require('@actions/core');
const github = require('@actions/github');
const get = require('lodash/get');
const { WebClient } = require('@slack/web-api');
const slack = new WebClient(token);

const delim = ' :: ';
const searchPrefix = 'Q-PR';

const buildTag = ({ issueNumber, status, title, url }) => {
  return [searchPrefix, issueNumber, status, `<${url}|${title}>`].join(delim);
};

const getMessage = (payload) => {
  const url = get(payload, 'comment.issue_url', '');
  const title = get(payload, 'issue.title');
  const issueNumber = get(payload, 'issue.number');

  return buildTag({ status: 'MERGING', issueNumber, title, url });
};

const setActionStatus = (status) => {
  core.setOutput('status', status);
};

const findPrInQueue = async (payload) => {
  const channelName = core.getInput('channel');
  const issueNumber = get(payload, 'issue.number');
  const {
    messages: { matches },
  } = await slack.search.messages({
    query: searchPrefix,
    sort: 'timestamp',
  });
  return matches.find(({ text, channel }) => {
    const [, num] = text.split(delim);
    return (
      num.trim() === issueNumber.toString() && channel.name === channelName
    );
  });
};

(async function main() {
  try {
    const payload = get(github, 'context.payload', {});
    const trigger = core.getInput('trigger');
    const channel = core.getInput('channel');
    const commentMsg = get(payload, 'comment.body', '');
    const state = get(payload, 'issue.state');
    const commentArr = commentMsg.split('\n').filter(Boolean);

    core.info(`comment:\n ${JSON.stringify(commentArr)}\n`);

    if (state !== 'open') {
      core.info('PR already closed');
      return setActionStatus('ALREADY_CLOSED');
    }

    if (!commentMsg.includes(trigger)) {
      core.info('Trigger not found');
      return setActionStatus('TRIGGER_NOT_FOUND');
    }

    const match = await findPrInQueue(payload);

    if (match) {
      core.info(`PR already in queue:\n ${JSON.stringify(match, null, 2)}`);
      return setActionStatus('ALREADY_QUEUED');
    }

    core.info(`Trigger found. adding PR to queue:\n`);
    const text = getMessage(payload);
    const result = await slack.chat.postMessage({
      channel,
      text,
      mrkdwn: true,
    });
    core.info(JSON.stringify(result, null, 2));

    setActionStatus('ADDED_TO_QUEUE');
  } catch (error) {
    setActionStatus('FAILURE');
    core.setFailed(error.message);
  }
})();
