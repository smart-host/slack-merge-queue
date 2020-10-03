const core = require('@actions/core');
const get = require('lodash/get');

const { DELIM, SEARCH_PREFIX, Q_STATUS } = require('./consts');

const buildTag = ({ issueNumber, status, title, url }) => {
  return [SEARCH_PREFIX, issueNumber, status, `<${url}|${title}>`].join(DELIM);
};

const getMessage = (payload) => {
  const url = get(payload, 'comment.issue_url', '');
  const title = get(payload, 'issue.title');
  const issueNumber = get(payload, 'issue.number');

  return buildTag({ status: Q_STATUS.MERGING, issueNumber, title, url });
};

const setActionStatus = (status) => {
  core.setOutput('status', status);
};

const findPrInQueue = async (payload, client) => {
  const channelName = core.getInput('channel');
  const issueNumber = get(payload, 'issue.number');
  const {
    messages: { matches },
  } = await client.search.messages({
    query: SEARCH_PREFIX,
    sort: 'timestamp',
  });
  return matches.find(({ text, channel }) => {
    const [, num] = text.split(DELIM);
    return (
      num.trim() === issueNumber.toString() && channel.name === channelName
    );
  });
};

module.exports = {
  findPrInQueue,
  setActionStatus,
  getMessage,
  buildTag,
};
