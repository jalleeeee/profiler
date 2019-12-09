/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow

/**
 * This file is in charge of handling the message managing between profiler.firefox.com
 * and the browser internals. This is done through a WebChannel mechanism. This mechanism
 * allows us to safely send messages between the browser and an allowed domain.
 */

/**
 * The messages are typed as an object so that the "type" field can be extracted
 * using the $Keys utility type.
 */
type MessageToBrowserObject = {|
  STATUS_QUERY: {| type: 'STATUS_QUERY' |},
  ENABLE_MENU_BUTTON: {| type: 'ENABLE_MENU_BUTTON' |},
|};

/**
 * The messages are typed as an object so that the "type" field can be extracted
 * using the $Keys utility type.
 */
type MessageFromBrowserObject = {|
  STATUS_RESPONSE: {|
    type: 'STATUS_RESPONSE',
    menuButtonIsEnabled: boolean,
  |},
  ENABLE_MENU_BUTTON_DONE: {| type: 'ENABLE_MENU_BUTTON_DONE' |},
|};

// Extract out the different values. Exported for tests.
export type MessageToBrowser = $Values<MessageToBrowserObject>;
export type MessageFromBrowser = $Values<MessageFromBrowserObject>;
export type MessageFromBrowserTypes = $Keys<MessageFromBrowserObject>;

/**
 * Ask the browser if the menu button is enabled.
 */
export async function queryIsMenuButtonEnabled(): Promise<boolean> {
  type ExpectedResponse = $PropertyType<
    MessageFromBrowserObject,
    'STATUS_RESPONSE'
  >;

  const response: ExpectedResponse = await _sendMessageWithResponse({
    message: { type: 'STATUS_QUERY' },
    expectedResponse: 'STATUS_RESPONSE',
  });

  return response.menuButtonIsEnabled;
}

/**
 * Enable the profiler menu button.
 */
export async function enableMenuButton(): Promise<void> {
  type ExpectedResponse = $PropertyType<
    MessageFromBrowserObject,
    'ENABLE_MENU_BUTTON_DONE'
  >;

  await _sendMessageWithResponse<ExpectedResponse>({
    message: { type: 'ENABLE_MENU_BUTTON' },
    expectedResponse: 'ENABLE_MENU_BUTTON_DONE',
  });

  // The response does not return any additional information other than we know
  // the request was handled.
}

/**
 * -----------------------------------------------------------------------------
 *
 * Everything below here is implementation logic for handling messages with from
 * the WebChannel mechanism.
 */

const LOG_STYLE = 'font-weight: bold; color: #0a6';

/**
 * Register a one off listener to handle the results of queries to the browser.
 * The callback should return true when the correct message is found.
 */
function _registerOneOffListener(
  callback: MessageFromBrowser => boolean,
  reject: (error: mixed) => void
) {
  // Create the listener in-line here.
  function listener(event) {
    const { id, message } = event.detail;

    // Don't trust the message too much, and do some checking for known properties.
    if (
      id === 'profiler.firefox.com' &&
      message &&
      typeof message === 'object'
    ) {
      // Pull out the values in the message, since we now know it's an object.
      const { error, type } = message;

      // We have a message.
      if (typeof error === 'string') {
        // There was some kind of error with the message. This is expected for older
        // versions of Firefox that don't have this WebChannel set up yet, or
        // if the the about:config points to a different URL.
        console.error(`[webchannel] %c${error}`, LOG_STYLE);
        window.removeEventListener(
          'WebChannelMessageToContent',
          listener,
          true
        );
        reject(message);
        return;
      } else if (typeof type === 'string') {
        // This appears to be a valid message, pass it to the callback without additional
        // type checking.
        if (callback((message: any))) {
          if (process.env.NODE_ENV === 'development') {
            console.log(
              `[webchannel] %creceived "${type}"`,
              LOG_STYLE,
              message
            );
          }
          window.removeEventListener(
            'WebChannelMessageToContent',
            listener,
            true
          );
        }
        return;
      }
    }

    reject(new Error('A malformed WebChannel event was received.'));

    console.error(`[webchannel] %cmalformed event received`, LOG_STYLE, event);
  }

  window.addEventListener('WebChannelMessageToContent', listener, true);
}

/**
 * Send a message to the browser through the WebChannel.
 */
function _sendMessage(message) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[webchannel] %csending "${message.type}"`, LOG_STYLE, message);
  }

  window.dispatchEvent(
    new CustomEvent('WebChannelMessageToChrome', {
      detail: JSON.stringify({
        id: 'profiler.firefox.com',
        message,
      }),
    })
  );
}

type MessageRequest = {|
  message: MessageToBrowser,
  expectedResponse: MessageFromBrowserTypes,
|};

function _sendMessageWithResponse<Returns: MessageFromBrowser>({
  message,
  expectedResponse,
}: MessageRequest): Promise<Returns> {
  return new Promise((resolve, reject) => {
    function handleMessage(message: *) {
      if (message.type === expectedResponse) {
        // Deliver the result to the callee.
        resolve(((message: MessageFromBrowser): any));

        // Remove the listener.
        return true;
      }
      // Keep listening.
      return false;
    }
    _registerOneOffListener(handleMessage, reject);
    _sendMessage(message);
  });
}
