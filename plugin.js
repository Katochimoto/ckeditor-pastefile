(function() {
    'use strict';

    CKEDITOR.config.pastefileUploadPostParam = 'attachment';

    /**
     * Нода, на которую можно дропать
     * @param {Editor} editor
     * @returns {HTMLElement}
     */
    CKEDITOR.config.pastefileGetDropContext = function(editor) {
        return document;
    };

    /**
     * Нода, в которой показываем плейсхолдер
     * @param {Editor} editor
     * @returns {CKEDITOR.dom.element}
     */
    CKEDITOR.config.pastefileGetPlaceholderContext = function(editor) {
        return editor.ui.space('contents_wrap');
    };

    /**
     * Формирование атрибутов для инлайн картинки
     * Обязательный атрибут src
     * @param {CKEDITOR.fileTools.fileLoader} loader
     * @returns {Object}
     */
    CKEDITOR.config.pastefileCreateImageAttributes = function(loader) {
        return { /* src */ };
    };

    /**
     * Санитайзер html
     * @param {string} html
     * @returns {vow.Promise}
     */
    CKEDITOR.config.pastefileHtmlSanitize = function(html) {
        return new vow.Promise(function(resolve) {
            resolve(html);
        });
    };

    var CMD_PLACEHOLDER = 'pastefilePlaceholder';

    CKEDITOR.plugins.add('pastefile', {
        modes: { 'wysiwyg': 1, 'source': 1 },

        onLoad: function() {
            CKEDITOR.addCss(
                '.cke_pasteimage_placeholder:after {content: "' + "Вставьте файл прямо в текст" + '";}' +
                '.cke_pastefile_placeholder:before {content: "' + "Перетащите файл сюда" + '";}' +
                '.cke_pastefile_placeholder.cke_pasteimage_placeholder:after {content: "";}' +
                '.cke_maximized .cke_pastefile_placeholder.cke_pasteimage_placeholder:after {content: "' + "Вставьте файл прямо в текст" + '";}'
            );
        },

        init: function(editor) {
            var command = editor.addCommand(CMD_PLACEHOLDER, {
                'modes': { 'wysiwyg': 1, 'source': 1 },
                'editorFocus': false,
                'exec': function(editor, data) {
                    if (this.state !== CKEDITOR.TRISTATE_ON) {
                        return;
                    }

                    var placeholderContext = editor.config.pastefileGetPlaceholderContext(editor);
                    placeholderContext.addClass('cke_pastefile_placeholder');

                    if (data === 'inline') {
                        editor.ui.space('contents_wrap').addClass('cke_pasteimage_placeholder');
                    }
                }
            });

            command.on('state', function() {
                if (this.state !== CKEDITOR.TRISTATE_ON) {
                    var placeholderContext = editor.config.pastefileGetPlaceholderContext(editor);
                    placeholderContext.removeClass('cke_pastefile_placeholder');
                    editor.ui.space('contents_wrap').removeClass('cke_pasteimage_placeholder');
                }
            });

            editor.on('paste', this._onPaste);
            editor.on('destroy', this._onDestroy);
            editor.on('contentDom', this._onContentDom);
        },

        _onDestroy: function() {
            if (this._pastefileDNDHover) {
                this._pastefileDNDHover.destroy();
            }
        },

        _onContentDom: function() {
            var editable = this.editable();
            var command = this.getCommand(CMD_PLACEHOLDER);

            var placeholderHide = function() {
                if (command.state === CKEDITOR.TRISTATE_DISABLED) {
                    return;
                }

                command.setState(CKEDITOR.TRISTATE_OFF);
            };

            var placeholderShow = function(eventName, event) {
                if (command.state === CKEDITOR.TRISTATE_DISABLED) {
                    return;
                }

                command.setState(CKEDITOR.TRISTATE_ON);

                if (event.dataTransfer) {
                    var data = new ClipboardDataIterator(event.dataTransfer).search();

                    if (data.inline) {
                        command.exec('inline');

                    } else if (data.file) {
                        command.exec('file');
                    }
                }
            };

            this.on('dragstart', function() {
                command.disable();
            });

            this.on('dragend', function() {
                command.enable();
            });

            var dropContext = this.config.pastefileGetDropContext(this);

            this._pastefileDNDHover = new DNDHover(dropContext);
            this._pastefileDNDHover.on('enter', placeholderShow);
            this._pastefileDNDHover.on('leave', placeholderHide);
        },

        /**
         * @this {Editor}
         */
        _onPaste: function(event) {
            var eventMethod = event.data.method;
            var dataTransfer = event.data.dataTransfer;
            var clipboardData = dataTransfer.$;

            // в IE11 clipboardData может не быть при вставке текста
            // @see DARIA-50325
            if (!clipboardData) {
                return;
            }

            // CKEDITOR.config.imageUploadUrl
            var uploadUrl = CKEDITOR.fileTools.getUploadUrl(this.config, 'image');
            var clipboardIterator = new ClipboardDataIterator(clipboardData);

            clipboardIterator.on('iterator:inline', function(item) {
                var loader = this.uploadRepository.create(item);
                loader.on('uploaded', this.plugins.pasteimage._onImageUploaded.bind(this, loader));
                loader.loadAndUpload(uploadUrl, this.config.pastefileUploadPostParam);
            }, this);

            clipboardIterator.on('iterator:file', function(item) {
                // вставка файлов обрабатывается только для драга
                if (eventMethod === 'drop') {
                    this.fire('pasteimage:pastefile', [ item ]);
                }
            }, this);

            clipboardIterator.on('iterator:html', function(html) {
                this.config.pastefileHtmlSanitize(html)
                    .always(this.plugins.pasteimage._onAlwaysSanitize, this);
            }, this);

            var data = clipboardIterator.iterate();
            if (data.prevent) {
                event.cancel();
            }
        },

        /**
         * @this {Editor}
         * @throw Error
         */
        _onImageUploaded: function(loader) {
            var attrs = this.config.pastefileCreateImageAttributes(loader);
            if (!attrs.src) {
                throw Error('The src attribute must be defined');
            }

            var element = new CKEDITOR.dom.element('img');

            element.on('load', function() {
                this.insertHtml(element.getOuterHtml(), 'unfiltered_html');
            }, this);

            element.setAttributes(attrs);
        },

        /**
         * @this {Editor}
         */
        _onAlwaysSanitize: function(html) {
            this.insertHtml(html, 'unfiltered_html');
        }
    });


    function DNDHover(node) {
        this._node = node;
        this._collection = [];
        this._show = this._show.bind(this);
        this._hide = this._hide.bind(this);

        this._node.addEventListener('dragenter', this._show, false);
        this._node.addEventListener('dragleave', this._hide, false);
        this._node.addEventListener('drop', this._hide, false);
    }

    CKEDITOR.event.implementOn(DNDHover.prototype);

    DNDHover.prototype._show = function(event) {
        event.stopPropagation();
        event.preventDefault();

        if (!this._collection.length) {
            this.fire('enter', event);
        }

        this._collection.push(event.target);
    };

    DNDHover.prototype._hide = function(event) {
        event.stopPropagation();
        event.preventDefault();

        var idx = this._collection.indexOf(event.target);
        if (idx !== -1) {
            this._collection.splice(idx, 1);
        }

        if (!this._collection.length) {
            this.fire('leave', event);
        }
    };

    DNDHover.prototype.destroy = function() {
        this.removeAllListeners();
        this._node.removeEventListener('dragenter', this._show, false);
        this._node.removeEventListener('dragleave', this._hide, false);
        this._node.removeEventListener('drop', this._hide, false);
        this._node = null;
        this._collection = [];
    };


    function ClipboardDataIterator(data) {
        this._data = data;
        this._items = [];
        this._iterator = _.noop;
        this._iteratorSearch = _.noop;

        var type;

        if (data.files && data.files.length) {
            this._items = data.files;
            type = 'files';

        } else if (data.items) {
            this._items = data.items;
            type = 'items';

        } else if (data.types) {
            this._items = data.types;
            type = 'types';
        }

        if (type) {
            this._iterator = this._iterators[ type ];
            this._iteratorSearch = this._iteratorsSearch[ type ];
        }
    }

    CKEDITOR.event.implementOn(ClipboardDataIterator.prototype);

    ClipboardDataIterator.prototype.MAX_SIZE = 10 * 1024 * 1024; // 10MB

    ClipboardDataIterator.prototype.REG_IMAGE_TYPE = /image\/(jpeg|pjpeg|png|gif|bmp)/;

    ClipboardDataIterator.prototype.REG_BREAK_TYPE = /text\/(rtf|plain)/;

    ClipboardDataIterator.prototype.REG_CHROME_LINUX = /^<meta.*?>/;

    ClipboardDataIterator.prototype.REG_CHROME_WINDOWS = /<!--StartFragment-->([\s\S]*)<!--EndFragment-->/;

    ClipboardDataIterator.prototype.REG_CONTENT_IMG = /^<img[^>]*?src="(.*?)".*?>$/;

    /**
     * Поиск файлов/картинок
     * @returns {{ inline: boolean, file: boolean }}
     */
    ClipboardDataIterator.prototype.search = function() {
        var data = {};
        Array.prototype.some.call(this._items, this._iteratorSearch.bind(this, data));
        return data;
    };

    /**
     * Обход данных
     * @returns {{ prevent: boolean }}
     */
    ClipboardDataIterator.prototype.iterate = function() {
        var data = {};
        Array.prototype.some.call(this._items, this._iterator.bind(this, data));
        return data;
    };

    ClipboardDataIterator.prototype._createImgHtml = function(attributes) {
        var writer = new CKEDITOR.htmlWriter();
        writer.openTag('img');
        for (var attrName in attributes) {
            writer.attribute(attrName, attributes[ attrName ]);
        }
        writer.openTagClose('img', true);
        return writer.getHtml();
    }

    ClipboardDataIterator.prototype._findImgFromHtml = function(data, callback) {
        data = data.replace(this.REG_CHROME_LINUX, '');
        var result = this.REG_CHROME_WINDOWS.exec(data);
        if (result && result.length > 1) {
            data = result[ 1 ];
        }

        var src = (this.REG_CONTENT_IMG.exec(data) || [])[ 1 ];
        if (!src) {
            return false;
        }

        var that = this;
        var parser = new CKEDITOR.htmlParser();
        parser.onTagOpen = function(tagName, attributes) {
            if (tagName !== 'img' || attributes[ 'data-cke-saved-src' ] || !attributes[ 'src' ]) {
                return;
            }

            callback.call(that, that._createImgHtml(attributes));
        };

        parser.parse(data);
        return true;
    };

    ClipboardDataIterator.prototype._iteratorsSearch = {
        'files': function(data, item) {
            if (CKEDITOR.fileTools.isTypeSupported(item, this.REG_IMAGE_TYPE)) {
                if (item.size <= this.MAX_SIZE) {
                    data.inline = true;
                }

            } else {
                data.file = true;
            }

            return false;
        },

        'items': function(data, item) {
            if (CKEDITOR.fileTools.isTypeSupported(item, this.REG_BREAK_TYPE)) {
                return true;
            }

            if (CKEDITOR.fileTools.isTypeSupported(item, this.REG_IMAGE_TYPE)) {
                data.inline = true;

            } else {
                data.file = true;
            }

            return false;
        },

        'types': function(data, item) {
            if (item === 'public.url') {
                data.inline = true;
                return true;
            }

            if (item === 'Files') {
                data.file = true;
                return true;
            }

            return false;
        }
    };

    ClipboardDataIterator.prototype._iterators = {
        'files': function(data, item) {
            data.prevent = true;

            if (CKEDITOR.fileTools.isTypeSupported(item, this.REG_IMAGE_TYPE)) {
                if (item.size <= this.MAX_SIZE) {
                    this.fire('iterator:inline', item);
                    return false;
                }
            }

            this.fire('iterator:file', item);
            return false;
        },

        'items': function(data, item) {
            if (CKEDITOR.fileTools.isTypeSupported(item, this.REG_BREAK_TYPE)) {
                return true;
            }

            if (CKEDITOR.fileTools.isTypeSupported(item, this.REG_IMAGE_TYPE)) {
                var blob = item.getAsFile();
                if (blob && blob.size <= this.MAX_SIZE) {
                    data.prevent = true;
                    this.fire('iterator:inline', blob);
                    return true;
                }
            }

            return false;
        },

        'types': function(data, item) {
            if (item === 'public.url') {
                data.prevent = true;

                this.fire('iterator:html', this._createImgHtml({
                    'src': this._data.getData(item)
                }));

                return true;
            }

            if (item === 'text/html') {
                var html = this._data.getData(item);
                var isImgOnly = this._findImgFromHtml(html, function(imgHtml) {
                    this.fire('iterator:html', imgHtml);
                });

                if (isImgOnly) {
                    data.prevent = true;
                    return true;
                }
            }

            return false;
        }
    };

}());
