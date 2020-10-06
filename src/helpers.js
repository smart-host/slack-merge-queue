const core = require('@actions/core');
const get = require('lodash/get');

const { DELIM, SEARCH_PREFIX, Q_STATUS } = require('./consts');

const buildTag = ({ issueNumber, status, title, url }) => {
  return [SEARCH_PREFIX, issueNumber, status, `<${url}|${title}>`].join(DELIM);
};

const parseTag = (str) => {
  const [searchPrefix, issueNumber, status, url] = str.split(DELIM.trim());
  return {
    searchPrefix: searchPrefix.trim(),
    issueNumber: issueNumber.trim(),
    mergeStatus: status.trim(),
    url: url.trim(),
  };
};

const getMessage = (payload) => {
  const url = get(payload, 'comment.html_url', '').split('#')[0];
  const title = get(payload, 'issue.title');
  const issueNumber = get(payload, 'issue.number');

  return buildTag({ status: Q_STATUS.MERGING, issueNumber, title, url });
};

const setActionStatus = (status) => {
  core.setOutput('status', status);
};

const getHistory = async ({ client, channel, ...opts }) => {
  let msgs = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const {
      messages,
      response_metadata,
      has_more,
    } = await client.conversations.history({
      channel,
      cursor,
      ...opts,
    });

    hasMore = has_more;
    cursor = response_metadata.next_cursor;

    msgs = [
      ...msgs,
      ...messages.filter(({ text }) => text.includes(SEARCH_PREFIX)),
    ];
  }

  return { messages: msgs };
};

const findPrInQueue = async ({ payload, client, filter = () => true }) => {
  const channelName = core.getInput('channel');
  const { issueNumber } = payload;

  const { messages: matches } = await getHistory({
    client,
    channel: channelName,
  });
  return matches.find((message) => {
    const { text } = message;
    const { issueNumber: num } = parseTag(text);
    return num.trim() === issueNumber.toString() && filter(message);
  });
};

const findNextWithMergingStatus = async ({ client, payload }) => {
  const channelName = core.getInput('channel');
  const { issueNumber } = payload;
  const { messages: matches } = await getHistory({
    client,
    channel: channelName,
  });
  return matches.find((message) => {
    const { text } = message;
    const { mergeStatus, issueNumber: num } = parseTag(text);
    return (
      num.trim() !== issueNumber.toString() && Q_STATUS.MERGING === mergeStatus
    );
  });
};

const WATCHERS_TITLE = 'Watchers';

const getWatchers = (match) => {
  let watchers = '';

  if (Array.isArray(match.attachments)) {
    const { fields } =
      match.attachments.find(({ title }) => title.includes(WATCHERS_TITLE)) ||
      {};
    if (fields) {
      watchers = `\n${fields[0].value}`;
    }
  }

  return watchers;
};

const ATTACH_PREFIXES = ['notify:']; //

const processors = {
  'notify:': (text) => {
    const usersArr = text.replace('notify:', '').trim().split(',');
    const users = usersArr.map((user) => `<@${user.trim()}>`).join(', ');
    return {
      title: WATCHERS_TITLE,
      mrkdwn_in: ['text'],
      color: '#36a64f',
      fields: [{ value: users }],
    };
  },
};

const buildAttachment = (comments) => {
  if (!Array.isArray(comments)) {
    return undefined;
  }

  const attachments = ATTACH_PREFIXES.reduce((accu, next) => {
    const prefixText = comments.find((x) => x.includes(next));
    const process = processors[next] || ((text) => text);

    if (!prefixText) {
      return accu;
    }

    return [...accu, process(prefixText)];
  }, []);

  if (attachments.length === 0) {
    return undefined;
  }

  return attachments;
};

module.exports = {
  findPrInQueue,
  setActionStatus,
  getMessage,
  buildTag,
  parseTag,
  findNextWithMergingStatus,
  getWatchers,
  buildAttachment,
  getHistory,
};
