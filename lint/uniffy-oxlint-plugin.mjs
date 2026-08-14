const CDN_HOST_PATTERN =
  /unpkg\.com|cdn\.jsdelivr\.net|jsdelivr\.com|cdnjs\.cloudflare\.com|cdn\.skypack\.dev|esm\.sh|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.tailwindcss\.com|ajax\.googleapis\.com/i;

const CDN_RULE_MESSAGE =
  'External CDN URL detected. Bundle the asset locally via a Vite "?url" import or vendor it. ' +
  'Runtime CDN fetches leak user IP/referrer, break offline/air-gapped deploys, and create supply-chain risk.';

const noCdnUrls = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow third-party CDN URLs; all runtime assets must be bundled',
    },
    messages: {
      cdn: CDN_RULE_MESSAGE,
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === 'string' && CDN_HOST_PATTERN.test(node.value)) {
          context.report({ node, messageId: 'cdn' });
        }
      },
      TemplateElement(node) {
        if (CDN_HOST_PATTERN.test(node.value.raw)) {
          context.report({ node, messageId: 'cdn' });
        }
      },
    };
  },
};

const EXPO_PUBLIC_MESSAGE =
  'EXPO_PUBLIC_* env vars are banned: the mobile app carries zero baked configuration. ' +
  'The server URL is chosen at login and everything else comes from the backend.';

const noExpoPublicEnv = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow EXPO_PUBLIC_* environment variables; mobile config is runtime-only',
    },
    messages: {
      expoPublic: EXPO_PUBLIC_MESSAGE,
    },
    schema: [],
  },
  create(context) {
    const nameOf = (key) => {
      if (key.type === 'Identifier') return key.name;
      if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
      return null;
    };
    return {
      MemberExpression(node) {
        const name = nameOf(node.property);
        if (name?.startsWith('EXPO_PUBLIC_')) {
          context.report({ node, messageId: 'expoPublic' });
        }
      },
      Property(node) {
        const name = nameOf(node.key);
        if (name?.startsWith('EXPO_PUBLIC_') && node.parent?.type === 'ObjectPattern') {
          context.report({ node, messageId: 'expoPublic' });
        }
      },
    };
  },
};

const RAW_ERROR_MESSAGE =
  'Raw backend error text must not reach the user. Route it through friendlyErrorMessage() ' +
  '(web, @/config/errorMessages.ts) or a mapping helper that owns the user-facing copy.';

const STATUS_CODE_MESSAGE =
  'Status codes are not user-facing copy. Map the code to a sentence in errorMessages.ts ' +
  '(or the surface-owning helper) instead of interpolating it into the UI.';

const ERRISH_NAME = /^(e|err|error|exception|ex)$/i;
const ERRISH_SUFFIX = /(Error|Err|Exception)$/;
const STATUS_PROPS = new Set(['status', 'statusCode']);

const isErrishName = (name) =>
  typeof name === 'string' && (ERRISH_NAME.test(name) || ERRISH_SUFFIX.test(name));

// Strip TS casts, non-null assertions, optional-chain wrappers, parens.
const unwrap = (node) => {
  let cur = node;
  while (
    cur &&
    (cur.type === 'TSAsExpression' ||
      cur.type === 'TSNonNullExpression' ||
      cur.type === 'TSSatisfiesExpression' ||
      cur.type === 'ChainExpression' ||
      cur.type === 'ParenthesizedExpression')
  ) {
    cur = cur.expression;
  }
  return cur;
};

const propName = (member) => {
  if (member.property.type === 'Identifier') return member.property.name;
  if (member.property.type === 'Literal') return member.property.value;
  return null;
};

const noRawErrorDisplay = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw backend errors and status codes in user-facing display sinks',
    },
    messages: {
      rawError: RAW_ERROR_MESSAGE,
      statusCode: STATUS_CODE_MESSAGE,
    },
    schema: [],
  },
  create(context) {
    const isErrishExpr = (node) => {
      const inner = unwrap(node);
      return inner?.type === 'Identifier' && isErrishName(inner.name);
    };

    // Walk display-sink arguments for raw error shapes. Recursion deliberately
    // stops at CallExpression: a call is a transformation (friendlyErrorMessage,
    // serverMessage, ...) and owns its output.
    const checkSinkExpr = (node, jsx) => {
      const inner = unwrap(node);
      if (!inner) return;
      switch (inner.type) {
        case 'Identifier':
          if (!jsx && isErrishName(inner.name)) {
            context.report({ node: inner, messageId: 'rawError' });
          }
          return;
        case 'MemberExpression': {
          const prop = propName(inner);
          if ((prop === 'message' || prop === 'rawMessage') && isErrishExpr(inner.object)) {
            context.report({ node: inner, messageId: 'rawError' });
          } else if (!jsx && typeof prop === 'string' && STATUS_PROPS.has(prop)) {
            context.report({ node: inner, messageId: 'statusCode' });
          }
          return;
        }
        case 'TemplateLiteral':
          for (const expr of inner.expressions) checkSinkExpr(expr, jsx);
          return;
        case 'BinaryExpression':
          if (inner.operator === '+') {
            checkSinkExpr(inner.left, jsx);
            checkSinkExpr(inner.right, jsx);
          }
          return;
        case 'ConditionalExpression':
          checkSinkExpr(inner.consequent, jsx);
          checkSinkExpr(inner.alternate, jsx);
          return;
        case 'LogicalExpression':
          checkSinkExpr(inner.left, jsx);
          checkSinkExpr(inner.right, jsx);
          return;
        case 'CallExpression': {
          // String(err) is a stringification, not a mapping.
          const callee = unwrap(inner.callee);
          if (
            callee?.type === 'Identifier' &&
            callee.name === 'String' &&
            inner.arguments.length === 1 &&
            isErrishExpr(inner.arguments[0])
          ) {
            context.report({ node: inner, messageId: 'rawError' });
          }
          return;
        }
        default:
          return;
      }
    };

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee?.type !== 'MemberExpression') return;
        const obj = unwrap(callee.object);
        const method = propName(callee);
        const isToastSink =
          obj?.type === 'Identifier' &&
          obj.name === 'toast' &&
          (method === 'error' || method === 'warning');
        const isAlertSink =
          obj?.type === 'Identifier' && obj.name === 'Alert' && method === 'alert';
        if (!isToastSink && !isAlertSink) return;
        for (const arg of node.arguments) checkSinkExpr(arg, false);
      },
      JSXExpressionContainer(node) {
        checkSinkExpr(node.expression, true);
      },
    };
  },
};

export default {
  meta: { name: 'uniffy' },
  rules: {
    'no-cdn-urls': noCdnUrls,
    'no-expo-public-env': noExpoPublicEnv,
    'no-raw-error-display': noRawErrorDisplay,
  },
};
