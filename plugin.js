(function() {
    'use strict';

    /*
    CKEDITOR.plugins.setLang('pastefile', 'ru', {
    	'inlinePlaceholder': 'Вставьте файл прямо в текст',
        'attachPlaceholder': 'Перетащите файл сюда',
    });
    */

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
        return new CKEDITOR.dom.element(document.body);
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

        init: function(editor) {
            var command = editor.addCommand(CMD_PLACEHOLDER, {
                'modes': { 'wysiwyg': 1, 'source': 1 },
                'editorFocus': false,
                'canUndo': false,
                'exec': function(editor, data) {
                    if (this.state !== CKEDITOR.TRISTATE_ON) {
                        return;
                    }

                    var isMaximize = (editor.getCommand('maximize').state === CKEDITOR.TRISTATE_ON);
                    var wrap = editor.ui.space('contents_wrap');

                    if (isMaximize && wrap) {
                        wrap.setAttribute('data-cke-pastefile-placeholder', editor.lang.pastefile.inlinePlaceholder);
                        wrap.addClass('cke_pasteimage_placeholder');

                    } else if (!isMaximize) {
                        var placeholderContext = editor.config.pastefileGetPlaceholderContext(editor);
                        if (placeholderContext) {
                            placeholderContext.setAttribute('data-cke-pastefile-placeholder', editor.lang.pastefile.attachPlaceholder);
                            placeholderContext.addClass('cke_pastefile_placeholder');
                        }

                        if (data === 'inline' && wrap && editor.mode === 'wysiwyg') {
                            wrap.addClass('cke_pasteimage_placeholder');
                        }
                    }
                }
            });

            command.on('state', function() {
                if (this.state !== CKEDITOR.TRISTATE_ON) {
                    var placeholderContext = editor.config.pastefileGetPlaceholderContext(editor);
                    if (placeholderContext) {
                        placeholderContext.removeClass('cke_pastefile_placeholder');
                        placeholderContext.removeAttribute('data-cke-pastefile-placeholder');
                    }

                    var wrap = editor.ui.space('contents_wrap');
                    if (wrap) {
                        wrap.removeClass('cke_pasteimage_placeholder');
                        wrap.removeAttribute('data-cke-pastefile-placeholder');
                    }
                }
            });

            editor.on('dragstart', function() {
                command.disable();
            });

            editor.on('drop', function(event) {
                this._onDrop.call(editor, event);
                command.enable();
            }, this);

            editor.on('dragend', function() {
                command.enable();
            });

            editor.on('destroy', this._onDestroy);
            editor.on('maximize', this._dropContextReset);
            editor.on('mode', this._dropContextReset);
            editor.on('paste', this._onPaste);
        },

        _onDestroy: function() {
            if (this._pastefileDNDHover) {
                this._pastefileDNDHover.destroy();
            }

            this.getCommand(CMD_PLACEHOLDER).disable();
        },

        /**
         * Обработка drop.
         * Выполняется отдельно из-за необходимости игнорировать перетаскивание внутри редактора.
         * @param {CKEDITOR.eventInfo} event
         */
        _onDrop: function(event) {
            var command = this.getCommand(CMD_PLACEHOLDER);
            if (command.state === CKEDITOR.TRISTATE_DISABLED) {
                return;
            }

            var nativeEvent = event.data.$;

            // в IE11 dataTransfer может не быть при вставке текста
            // @see DARIA-50325
            if (!nativeEvent.dataTransfer) {
                return;
            }

            var plugin = this.plugins.pastefile;
            var clipboardIterator = new ClipboardDataIterator(nativeEvent.dataTransfer);
            clipboardIterator.on('iterator:inline', plugin._onIterateInline, this);
            clipboardIterator.on('iterator:file', plugin._onIterateFile, this);
            clipboardIterator.on('iterator:html', plugin._onIterateHtml, this);

            var data = clipboardIterator.iterate();
            if (data.prevent) {
                nativeEvent.preventDefault();
            }
        },

        /**
         * Обработка вставки.
         * Обрабатывается только копипаст.
         * @param {CKEDITOR.eventInfo} event
         */
        _onPaste: function(event) {
            // drop обрабатываем отдельно
            if (event.data.method !== 'paste') {
                return;
            }

            var dataTransfer = event.data.dataTransfer && event.data.dataTransfer.$;
            if (!dataTransfer) {
                return;
            }

            var plugin = this.plugins.pastefile;
            var clipboardIterator = new ClipboardDataIterator(dataTransfer);
            clipboardIterator.on('iterator:inline', plugin._onIterateInline, this);
            clipboardIterator.on('iterator:file', plugin._onIterateFile, this);
            clipboardIterator.on('iterator:html', plugin._onIterateHtml, this);

            var data = clipboardIterator.iterate();
            if (data.prevent) {
                event.cancel();
            }
        },

        _onIterateInline: function(event) {
            // @config CKEDITOR.config.imageUploadUrl
            var uploadUrl = CKEDITOR.fileTools.getUploadUrl(this.config, 'image');
            var loader = this.uploadRepository.create(event.data);
            loader.on('uploaded', this.plugins.pastefile._onImageUploaded.bind(this, loader));
            loader.loadAndUpload(uploadUrl, this.config.pastefileUploadPostParam);
        },

        _onIterateFile: function(event) {
            var data = Array.isArray(event.data) ? event.data : [ event.data ];
            this.fire('pastefile:dropfile', data);
        },

        _onIterateHtml: function(event) {
            this.config.pastefileHtmlSanitize(event.data)
                .then(
                    this.plugins.pastefile._onAlwaysSanitize,
                    this.plugins.pastefile._onAlwaysSanitize,
                    this
                );
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
        },

        /**
         * @this {Editor}
         */
        _dropContextReset: function() {
            if (this._pastefileDNDHover) {
                this._pastefileDNDHover.destroy();
                delete this._pastefileDNDHover;
            }

            var isMaximize = (this.getCommand('maximize').state === CKEDITOR.TRISTATE_ON);
            var dropContext;

            if (isMaximize) {
                dropContext = this.container.getFirst(function(node) {
                    return (node.type == CKEDITOR.NODE_ELEMENT && node.hasClass('cke_maximized'));
                });
                dropContext = dropContext && dropContext.$;
            }

            if (!dropContext) {
                dropContext = this.config.pastefileGetDropContext(this);
            }

            this._pastefileDNDHover = new DNDHover(dropContext, this);
            this._pastefileDNDHover.on('enter', this.plugins.pastefile._dropContextEnter, this);
            this._pastefileDNDHover.on('leave', this.plugins.pastefile._dropContextLeave, this);
            this._pastefileDNDHover.on('drop', this.plugins.pastefile._dropContextDrop, this);
        },

        /**
         * @this {Editor}
         */
        _dropContextDrop: function(event) {
            var command = this.getCommand(CMD_PLACEHOLDER);
            if (command.state === CKEDITOR.TRISTATE_DISABLED) {
                return;
            }

            var data = event.data.dataTransfer.files;
            if (data && data.length) {
                this.fire('pastefile:dropfile', data);
            }
        },

        /**
         * @this {Editor}
         */
        _dropContextEnter: function(event) {
            var command = this.getCommand(CMD_PLACEHOLDER);
            if (command.state === CKEDITOR.TRISTATE_DISABLED) {
                return;
            }

            command.setState(CKEDITOR.TRISTATE_ON);

            if (event.data.dataTransfer) {
                var data = new ClipboardDataIterator(event.data.dataTransfer).search();

                if (data.inline) {
                    command.exec('inline');

                } else if (data.file) {
                    command.exec('file');
                }
            }
        },

        /**
         * @this {Editor}
         */
        _dropContextLeave: function() {
            var command = this.getCommand(CMD_PLACEHOLDER);
            if (command.state === CKEDITOR.TRISTATE_DISABLED) {
                return;
            }

            command.setState(CKEDITOR.TRISTATE_OFF);
        }
    });


    function DNDHover(dropContext, editor) {
        this._dropContext = dropContext || document;
        this._editor = editor;
        this._stopDropPropagation = false;
        this._isShow = false;

        this._leaveDebounce = _.debounce(this._leave.bind(this), 100);
        this._onDragenter = this._onDragenter.bind(this);
        this._onDrop = this._onDrop.bind(this);
        this._onDragover = this._onDragover.bind(this);
        this._onScroll = _.throttle(this._onScroll.bind(this), 50);

        this._editor.on('dragend', this._onDragendEditor, this, null, -1);
        this._editor.on('drop', this._onDropEditor, this, null, -1);
        this._editor.editable().on('scroll', this._onScroll);
        window.addEventListener('dragover', this._onDragover, false);
        window.addEventListener('dragenter', this._onDragenter, false);
        window.addEventListener('drop', this._onDrop, false);
        window.addEventListener('scroll', this._onScroll, false);
    }

    CKEDITOR.event.implementOn(DNDHover.prototype);

    DNDHover.prototype._onScroll = function() {
        if (this._isShow) {
            this._leaveDebounce();
        }
    };

    DNDHover.prototype._onDragenter = function(event) {
        if (!this._isShow) {
            this._isShow = true;
            this.fire('enter', event);
        }
    };

    DNDHover.prototype._onDrop = function(event) {
        event.preventDefault();

        var isDropAction = (
            !this._stopDropPropagation &&
            (this._dropContext === event.target || this._dropContext.contains(event.target))
        );

        this._stopDropPropagation = false;

        this._leave();

        if (isDropAction) {
            this.fire('drop', event);
        }
    };

    /**
     * Выполняется без debounce, иначе перехват drop не сработает
     */
    DNDHover.prototype._onDragover = function(event) {
        var command = this._editor.getCommand(CMD_PLACEHOLDER);

        // нельзя превентить over при драге елементов внутри редактора
        // т.к. нам нужно нативное поведение
        if (command.state === CKEDITOR.TRISTATE_DISABLED) {
            return;
        }

        this._leaveDebounce();

        // разрешаем перехват drop
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    };

    DNDHover.prototype._onDropEditor = function() {
        this._stopDropPropagation = true;
        this._leave();
    };

    DNDHover.prototype._onDragendEditor = function() {
        this._stopDropPropagation = false;
        this._leave();
    };

    DNDHover.prototype._leave = function() {
        if (this._isShow) {
            this._isShow = false;
            this.fire('leave');
        }
    };

    DNDHover.prototype.destroy = function() {
        this.removeAllListeners();
        this._editor.removeListener('dragend', this._onDragendEditor);
        this._editor.removeListener('drop', this._onDropEditor);
        this._editor.editable().removeListener('scroll', this._onScroll);
        window.removeEventListener('dragover', this._onDragover, false);
        window.removeEventListener('dragenter', this._onDragenter, false);
        window.removeEventListener('drop', this._onDrop, false);
        window.removeEventListener('scroll', this._onScroll, false);
        this._dropContext = null;
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

    ClipboardDataIterator.prototype.REG_CONTENT_IMG = /^<img[^>]*?src="(.*?)".*?>$/;

    /**
     * Поиск файлов/картинок
     * @returns {{ inline: boolean, file: boolean }}
     */
    ClipboardDataIterator.prototype.search = function() {
        var data = {
            'inline': false,
            'file': false
        };

        Array.prototype.some.call(this._items, this._iteratorSearch.bind(this, data));

        return data;
    };

    /**
     * Обход данных
     * @returns {{ prevent: boolean }}
     */
    ClipboardDataIterator.prototype.iterate = function() {
        var data = {
            'prevent': false,
            'files': []
        };

        Array.prototype.some.call(this._items, this._iterator.bind(this, data));

        if (data.files.length) {
            this.fire('iterator:file', data.files);
        }

        delete data.files;
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
        data = String(data);

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

            data.files.push(item);
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
