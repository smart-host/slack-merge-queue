const core = require('@actions/core');
const get = require('lodash/get');
const findLast = require('lodash/findLast');
const uniq = require('lodash/uniq');
const takeWhile = require('lodash/takeWhile');
const takeRightWhile = require('lodash/takeRightWhile');
const takeRight = require('lodash/takeRight');
const findLastIndex = require('lodash/findLastIndex');

const {
  DELIM,
  SEARCH_PREFIX,
  Q_STATUS,
  WATCHERS_TITLE,
  ATTACH_PREFIXES,
  ATTACH_PREFIX,
} = require('./consts');

const getUsernames = ({ payload }) => {
  const assignees = get(payload, 'issue.assignees', []).map(
    ({ login }) => login,
  );
  const users = [
    ...assignees,
    get(payload, 'comment.user.login'),
    get(payload, 'issue.user.login'),
    get(payload, 'issue.sender.login'),
    get(payload, 'issue.assignee.login'),
  ]
    .filter(Boolean)
    .map((x) => x.toLowerCase());

  return users;
};

const buildTag = ({ issueNumber, status, title, url } = {}) => {
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
  const rawUrl =
    get(payload, 'comment.html_url') ||
    get(payload, 'review.html_url') ||
    get(payload, 'pull_request.html_url');
  const url = (rawUrl || '').split('#')[0];
  const title =
    get(payload, 'issue.title') || get(payload, 'pull_request.title');
  const issueNumber =
    get(payload, 'issue.number') || get(payload, 'pull_request.number');

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
    const { members, response_metadata, has_more } =
      await client.conversations.members({
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

const findChannel = async ({
  client,
  channelName,
  types = 'public_channel,private_channel',
  teamId,
  ...opts
}) => {
  let result = null;
  let hasMore = true;
  let cursor = undefined;

  core.debug(`channel to lookup: ${channelName}`);

  while (hasMore && !result) {
    const { channels, response_metadata, has_more } =
      await client.conversations.list({
        ...opts,
        cursor,
        types,
        team_id: teamId,
      });

    hasMore = has_more;
    cursor = response_metadata.next_cursor;

    result = channels.find(({ id, name, name_normalized }) => {
      core.debug(
        `channels lookup: ${JSON.stringify({ id, name, name_normalized })}`,
      );
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

const getHistory = async ({
  client,
  channel,
  historyThreshold = 10,
  ...opts
}) => {
  let msgs = [];
  let hasMore = true;
  let nonMergingCount = 0;
  let hasReachedThreshold = nonMergingCount >= historyThreshold;
  let cursor = undefined;

  core.debug(`history threshold: ${historyThreshold}`);

  while (hasMore) {
    const { messages, response_metadata, has_more } =
      await client.conversations.history({
        channel: channel.id,
        cursor,
        ...opts,
      });

    hasMore = hasReachedThreshold ? false : has_more;
    cursor = response_metadata.next_cursor;
    const mergeQueueMessages = messages.filter(({ text }) =>
      text.startsWith(SEARCH_PREFIX),
    );
    mergeQueueMessages.forEach(({ text }) => {
      if (!text.includes(Q_STATUS.MERGING)) {
        nonMergingCount++;
      }
    });

    msgs = [...msgs, ...mergeQueueMessages];
  }

  core.debug(`history threshold reached: ${hasReachedThreshold}`);

  return { messages: msgs };
};

const getMessageReplies = async ({ client, channel, ts, ...opts }) => {
  let msgs = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const { messages, response_metadata, has_more } =
      await client.conversations.replies({
        ...opts,
        channel: channel.id,
        cursor,
        ts,
      });

    hasMore = has_more;
    cursor = response_metadata.next_cursor;

    msgs = [...msgs, ...messages];
  }

  return { messages: msgs };
};

const findPrInQueue = async ({
  payload,
  client,
  channel,
  historyThreshold,
  filter = () => true,
}) => {
  const { issueNumber } = payload;

  const { messages: matches } = await getHistory({
    client,
    channel,
    historyThreshold,
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

  if (match && Array.isArray(match.attachments)) {
    const { fields } =
      match.attachments.filter(Boolean).find((data = {}) => {
        return get(data, 'title').includes(WATCHERS_TITLE);
      }) || {};
    if (fields) {
      watchers = `\n${fields[0].value}`;
    }
  }

  return watchers;
};

const getCommentTaggedValue = ({ tag, commentArr }) => {
  if (!tag || !Array.isArray(commentArr)) {
    return null;
  }
  const tagString = commentArr.find((x) => x.startsWith(tag));

  if (!tagString) {
    return null;
  }

  return tagString.replace(tag, '').trim();
};

const processors = {
  [ATTACH_PREFIX.NOTIFY]: ({ text, members, usernames }) => {
    const usersArr = (text || '')
      .replace(ATTACH_PREFIX.NOTIFY, '')
      .trim()
      .split(',');
    const usersToNotify = [...usernames, ...usersArr].filter(Boolean);
    core.debug(`raw list notify: ${JSON.stringify(usersToNotify)}`);
    const userRefs = usersToNotify
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

const buildAttachment = async ({
  comments,
  client,
  channel,
  usernames,
  ...opts
}) => {
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

    return [...accu, process({ text: prefixText, members, usernames })];
  }, []);

  if (attachments.length === 0) {
    return undefined;
  }

  return attachments;
};

const getFormattedComment = ({ payload }) => {
  const commentMsg =
    get(payload, 'comment.body', '') || get(payload, 'review.body');
  return commentMsg.split('\n').filter(Boolean);
};

const mergingFilter = ({ text }) => {
  if (!text) {
    return false;
  }
  const { mergeStatus } = parseTag(text);
  return mergeStatus === Q_STATUS.MERGING;
};

const organizeHistory = ({ messages, issueNumber }) => {
  const matchIndex = findLastIndex(messages, (message) => {
    const { text } = message;
    const { issueNumber: num, mergeStatus } = parseTag(text);
    const isCurrentPR = num.trim() === (issueNumber || '').toString();
    return isCurrentPR && mergeStatus === Q_STATUS.MERGING;
  });

  const match = messages[matchIndex];
  const newer = takeWhile(messages, (_, i) => i < matchIndex).filter(
    mergingFilter,
  );
  const older = takeRightWhile(messages, (_, i) => i > matchIndex).filter(
    mergingFilter,
  );

  const nextPr = takeRight(newer)[0];

  return {
    nextPr,
    messages,
    newer,
    older,
    current: match,
    currentIndex: matchIndex,
  };
};

const deleteThread = async ({ client, channel, message }) => {
  const { messages = [] } = await getMessageReplies({
    channel,
    ts: message.ts,
    client,
  });

  const promises = [...messages, message].map((m) => {
    return client.chat.delete({
      ts: m.ts,
      channel: channel.id,
    });
  });

  return Promise.all(promises);
};

const buildAlertMessage = ({ text, watchers }) => {
  const notify = watchers ? `\n\n${watchers}` : '';
  return `${text}${notify}`;
};

const selectFirstCorrect = ({
  allowed = [],
  values = [],
  default: defaultValue,
}) => {
  const filteredValues = values.filter((x) => allowed.includes(x));
  const [first] = filteredValues;
  return first || defaultValue;
};

const selectBoolString = (props) => {
  const values = props.values.map((x) => (x || '').toLowerCase());
  return selectFirstCorrect({ ...props, allowed: ['true', 'false'], values });
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
  organizeHistory,
  deleteThread,
  getMessageReplies,
  buildAlertMessage,
  selectFirstCorrect,
  selectBoolString,
  getCommentTaggedValue,
  getUsernames,
};
