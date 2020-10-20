const core = require('@actions/core');
const get = require('lodash/get');
const findLast = require('lodash/findLast');
const uniq = require('lodash/uniq');
const isMatch = require('lodash/isMatch');
const size = require('lodash/size');

const {
  DELIM,
  SEARCH_PREFIX,
  Q_STATUS,
  WATCHERS_TITLE,
  ATTACH_PREFIXES,
  ATTACH_PREFIX,
} = require('./consts');

const buildTag = ({ issueNumber, status, title, url }) => {
  return [SEARCH_PREFIX, issueNumber, status, `<${url}|${title}>`].join(DELIM);
};

const buildTagFromParse = ({ searchPrefix, issueNumber, mergeStatus, url }) => {
  return [searchPrefix, issueNumber, mergeStatus, url].join(DELIM);
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

const getUser = async ({ client, id }) => {
  const { user } = await client.users.info({ user: id });
  return user;
};

const getMembers = async ({ client, channel, ...opts }) => {
  let results = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const {
      members,
      response_metadata,
      has_more,
    } = await client.conversations.members({
      channel: channel.id,
      cursor,
      ...opts,
    });

    hasMore = has_more;
    cursor = response_metadata.next_cursor;

    const membersInfo = await Promise.all(
      members.map(async (id) => {
        const user = await getUser({ id, client });
        return user;
      }),
    );

    results = [...results, ...membersInfo];
  }

  return { members: results };
};

const findChannel = async ({ client, channelName, ...opts }) => {
  let result = null;
  let hasMore = true;
  let cursor = undefined;

  while (hasMore && !result) {
    const {
      channels,
      response_metadata,
      has_more,
    } = await client.conversations.list({
      ...opts,
      cursor,
      types: 'public_channel,private_channel',
    });

    hasMore = has_more;
    cursor = response_metadata.next_cursor;

    result = channels.find(({ id, name, name_normalized }) => {
      return [id, name, name_normalized].some((x) => x === channelName);
    });
  }

  return result;
};

const getUserFromName = ({ name: providedName, members }) => {
  const member = members.find(({ name, real_name, id, profile }) => {
    const pn = (providedName || '').trim();

    const possibleNames = [
      id,
      name,
      get(profile, 'email', '').split('@')[0],
      get(profile, 'display_name'),
      get(profile, 'display_name_normalized'),
      real_name,
      get(profile, 'real_name'),
      get(profile, 'real_name_normalized'),
    ];
    return possibleNames.some((x) => x === pn);
  });

  return member;
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
      channel: channel.id,
      cursor,
      ...opts,
    });

    hasMore = has_more;
    cursor = response_metadata.next_cursor;

    msgs = [
      ...msgs,
      ...messages.filter(({ text }) => text.startsWith(SEARCH_PREFIX)),
    ];
  }

  return { messages: msgs };
};

const findPrInQueue = async ({
  payload,
  client,
  channel,
  filter = () => true,
}) => {
  const { issueNumber } = payload;

  const { messages: matches } = await getHistory({
    client,
    channel,
  });

  return findLast(matches, (message, ...args) => {
    const { text } = message;
    const { issueNumber: num } = parseTag(text);
    return (
      num.trim() === issueNumber.toString() && filter(message, ...args, matches)
    );
  });
};

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

const processors = {
  [ATTACH_PREFIX.NOTIFY]: ({ text, members }) => {
    const usersArr = text.replace(ATTACH_PREFIX.NOTIFY, '').trim().split(',');
    const userRefs = usersArr
      .map((user) => {
        const { id } = getUserFromName({ name: user.trim(), members }) || {};
        if (!id) {
          return null;
        }

        return `<@${id}>`;
      })
      .filter(Boolean);
    const users = uniq(userRefs).join(', ');

    if (!users) {
      return undefined;
    }
    return {
      title: WATCHERS_TITLE,
      mrkdwn_in: ['text'],
      color: '#36a64f',
      fields: [{ title: '', short: false, value: users }],
    };
  },
};

const buildAttachment = async ({ comments, client, channel, ...opts }) => {
  if (!Array.isArray(comments)) {
    return undefined;
  }

  const { members } = await getMembers({
    ...opts,
    client,
    channel,
  });

  const attachments = ATTACH_PREFIXES.reduce((accu, next) => {
    const prefixText = comments.find((x) => x.startsWith(next));
    const process = processors[next] || ((text) => text);

    if (!prefixText) {
      return accu;
    }

    return [...accu, process({ text: prefixText, members })];
  }, []);

  if (attachments.length === 0) {
    return undefined;
  }

  return attachments;
};

const getFormattedComment = ({ payload }) => {
  const commentMsg = get(payload, 'comment.body', '');
  return commentMsg.split('\n').filter(Boolean);
};

module.exports = {
  findPrInQueue,
  setActionStatus,
  getMessage,
  buildTag,
  buildTagFromParse,
  parseTag,
  getWatchers,
  buildAttachment,
  getHistory,
  getMembers,
  getUserFromName,
  findChannel,
  getFormattedComment,
};
