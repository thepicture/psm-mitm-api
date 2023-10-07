"use strict";

module.exports = {
  proxy: {
    rotate: true,
  },
  traits: {
    you: {
      join: {
        delay: 3200,
      },
      replacers: [
        {
          match: /м/g,
          replacer: "ж",
        },
        {
          match: /М/g,
          replacer: "Ж",
        },
      ],
    },
    me: {
      join: {
        delay: 3200,
      },
      replacers: [
        {
          match: /м/g,
          replacer: "ж",
        },
        {
          match: /М/g,
          replacer: "Ж",
        },
      ],
    },
  },
};
