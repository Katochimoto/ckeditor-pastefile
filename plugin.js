(function() {
    'use strict';

    /*
    CKEDITOR.plugins.setLang('pastefile', 'ru', {
        'inlinePlaceholder': 'Вставьте файл прямо в текст',
        'attachPlaceholder': 'Перетащите файл сюда',
    });
    */

    /**
     * Игнорирование бросания файлов
     * @type {Boolean}
     */
    CKEDITOR.config.pastefileDisableFile = false;

    /**
     * Игнорирование бросания инлайновых файлов
     * @type {Boolean}
     */
    CKEDITOR.config.pastefileDisableInline = false;

    /**
     * Название post параметра для загрузки аттача
     * @type {String}
     */
    CKEDITOR.config.pastefileUploadPostParam = 'attachment';

    /**
     * Игнорирование бросания файлов не в рабочую область редактора
     * @type {Boolean}
     */
    CKEDITOR.config.pastefileDisableContext = false;

    /**
     * Проверка необходимости санитайза узла при вставке
     * @param {CKEDITOR.htmlParser.element} element
     * @returns {boolean}
     */
    CKEDITOR.config.pastefileCheckPasteSanitize = function(element) {
        return true;
    };

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

    var ATTR_PASTE_IGNORE = 'data-cke-pastefile-ignore';
    var ATTR_PASTE_INLINE = 'data-cke-pastefile-inline';
    var ATTR_PLACEHOLDER = 'data-cke-pastefile-placeholder';
    var CLASS_LOADER = 'cke_pastefile_loader';
    var CLASS_PLACEHOLDER_ATTACH = 'cke_pastefile_placeholder';
    var CLASS_PLACEHOLDER_INLINE = 'cke_pasteimage_placeholder';
    var CMD_LOADER = 'pastefileLoader';
    var CMD_PLACEHOLDER = 'pastefilePlaceholder';
    var REG_PASTE_SRC = /^http(s?):\/\//;
    var REG_IMAGE_TYPE = /image\/(jpeg|pjpeg|png|gif|bmp)/;

    function globalDragDisable() {
        for (var editorId in CKEDITOR.instances) {
            var editor = CKEDITOR.instances[ editorId ];
            var command = editor.getCommand(CMD_PLACEHOLDER);
            if (command) {
                command.disable();
            }
        }
    }

    function globalDragEnable() {
        for (var editorId in CKEDITOR.instances) {
            var editor = CKEDITOR.instances[ editorId ];
            var command = editor.getCommand(CMD_PLACEHOLDER);
            if (command) {
                command.enable();
            }
        }
    }

    CKEDITOR.plugins.add('pastefile', {
        modes: { 'wysiwyg': 1, 'source': 1 },

        init: function(editor) {
            var cmdLoader = editor.addCommand(CMD_LOADER, {
                'canUndo': false,
                'editorFocus': false,
                'modes': { 'wysiwyg': 1 }
            });

            cmdLoader.on('state', function() {
                var wrap = editor.ui.space('contents_wrap');

                if (this.state === CKEDITOR.TRISTATE_ON) {
                    wrap.addClass(CLASS_LOADER);

                } else {
                    wrap.removeClass(CLASS_LOADER);
                }
            });

            var cmdPlaceholder = editor.addCommand(CMD_PLACEHOLDER, {
                'modes': { 'wysiwyg': 1, 'source': 1 },
                'editorFocus': false,
                'canUndo': false,
                'exec': function(editor, data) {
                    if (this.state !== CKEDITOR.TRISTATE_ON) {
                        return;
                    }

                    var cmdMaximize = editor.getCommand('maximize');
                    var isMaximize = (cmdMaximize && cmdMaximize.state === CKEDITOR.TRISTATE_ON);
                    var isInline = (data === 'inline' && editor.mode === 'wysiwyg');
                    var wrap = editor.ui.space('contents_wrap');
                    var text;

                    if (isMaximize && wrap) {
                        text = isInline ?
                            editor.lang.pastefile.inlinePlaceholder :
                            editor.lang.pastefile.attachPlaceholder;

                        wrap.setAttribute(ATTR_PLACEHOLDER, text);
                        wrap.addClass(CLASS_PLACEHOLDER_INLINE);

                    } else if (!isMaximize) {
                        text = editor.lang.pastefile.attachPlaceholder;
                        var placeholderContext = editor.config.pastefileGetPlaceholderContext(editor);

                        if (isInline && wrap) {
                            wrap.setAttribute(ATTR_PLACEHOLDER, text);
                            wrap.addClass(CLASS_PLACEHOLDER_INLINE);

                        } else if (placeholderContext) {
                            placeholderContext.setAttribute(ATTR_PLACEHOLDER, text);
                        }

                        if (placeholderContext && !editor.config.pastefileDisableFile) {
                            placeholderContext.addClass(CLASS_PLACEHOLDER_ATTACH);
                        }
                    }
                }
            });

            cmdPlaceholder.on('state', function() {
                if (this.state !== CKEDITOR.TRISTATE_ON) {
                    var placeholderContext = editor.config.pastefileGetPlaceholderContext(editor);
                    if (placeholderContext) {
                        placeholderContext.removeClass(CLASS_PLACEHOLDER_ATTACH);
                        placeholderContext.removeAttribute(ATTR_PLACEHOLDER);
                    }

                    var wrap = editor.ui.space('contents_wrap');
                    if (wrap) {
                        wrap.removeClass(CLASS_PLACEHOLDER_INLINE);
                        wrap.removeAttribute(ATTR_PLACEHOLDER);
                    }
                }
            });

            editor.on('dragstart', globalDragDisable);
            editor.on('dragend', globalDragEnable);
            editor.on('drop', function(event) {
                this._onDrop.call(editor, event);
                globalDragEnable();
            }, this);

            editor.on('afterPaste', this._onAfterPaste);
            editor.on('beforeDestroy', this._onBeforeDestroy);
            editor.on('destroy', this._onDestroy);
            editor.on('instanceReady', this._onInstanceReady);
            editor.on('maximize', this._dropContextReset);
            editor.on('mode', this._dropContextReset);
            editor.on('paste', this._onPaste);
        },

        _onInstanceReady: function() {
            /*
            CKEDITOR.filter.transformationsTools.test = function(element) {
                element.attributes[ 'data-cke-pastefile-inline' ] = String(CKEDITOR.tools.getNextNumber());
            };
            */

            var editor = this;

            if (!this.pasteFilter) {
                this.pasteFilter = new CKEDITOR.filter(this);
            }

            this.pasteFilter.addTransformations([
                [
                    {
                        'element': 'img',
                        'left': function(element) {
                            return (
                                !element.attributes[ ATTR_PASTE_INLINE ] &&
                                !element.attributes[ ATTR_PASTE_IGNORE ] &&
                                element.attributes[ 'src' ] &&
                                REG_PASTE_SRC.test(element.attributes[ 'src' ]) &&
                                editor.config.pastefileCheckPasteSanitize(element)
                            );
                        },
                        'right': function(element) {
                            element.attributes[ ATTR_PASTE_INLINE ] = String(CKEDITOR.tools.getNextNumber());
                        }
                    }
                ]
            ]);
        },

        _onBeforeDestroy: function() {
            var selection = this.getSelection();
            if (selection) {
                selection.removeAllRanges();
            }
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
            var clipboardIterator = new ClipboardDataIterator(nativeEvent.dataTransfer, this.config.pastefileInlineMaxSize);
            clipboardIterator.on('iterator:inline', plugin._onIterateInline, this);
            clipboardIterator.on('iterator:file', plugin._onIterateFile, this);

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
            var clipboardIterator = new ClipboardDataIterator(dataTransfer, this.config.pastefileInlineMaxSize);
            clipboardIterator.on('iterator:inline', plugin._onIterateInline, this);
            clipboardIterator.on('iterator:file', plugin._onIterateFile, this);

            var data = clipboardIterator.iterate();
            if (data.prevent) {
                event.cancel();
            }
        },

        _onAfterPaste: function() {
            var cache = {};
            var nodes = this.editable().find('[' + ATTR_PASTE_INLINE + ']');
            var html = Array.prototype.reduce.call(nodes.$, function(previousValue, node) {
                cache[ node.getAttribute(ATTR_PASTE_INLINE) ] = node;
                // TODO если сделаем замену ссылок в background
                // то тут надо проверять на наличие детей
                // и санитайзить клон без детей
                return previousValue + node.outerHTML;
            }, '');

            if (html) {
                var cmdLoader = this.getCommand(CMD_LOADER);
                cmdLoader.setState(CKEDITOR.TRISTATE_ON);

                this.config.pastefileHtmlSanitize(html).then(
                    this.plugins.pastefile._onAfterPasteSanitizeSuccess.bind(this, cache),
                    this.plugins.pastefile._onAfterPasteSanitizeError.bind(this, cache)
                ).always(function() {
                    cmdLoader.setState(CKEDITOR.TRISTATE_OFF);
                });
            }
        },

        _onAfterPasteSanitizeSuccess: function(cache, sanitizeHtml) {
            var parser = new CKEDITOR.htmlParser();

            parser.onTagOpen = function(tagName, attributes) {
                var node = cache[ attributes[ ATTR_PASTE_INLINE ] ];
                if (!node) {
                    return;
                }

                delete cache[ attributes[ ATTR_PASTE_INLINE ] ];

                node.removeAttribute(ATTR_PASTE_INLINE);
                node.setAttribute(ATTR_PASTE_IGNORE, '1');

                if (attributes.style) {
                    node.setAttribute('style', attributes.style);
                }

                if (attributes.src) {
                    node.setAttribute('src', attributes.src);
                    node.setAttribute('data-cke-saved-src', attributes.src);
                }
            };

            parser.parse(sanitizeHtml);

            for (var id in cache) {
                cache[ id ].removeAttribute(ATTR_PASTE_INLINE);
            }

            this.fire('updateSnapshot');
        },

        _onAfterPasteSanitizeError: function(cache) {
            for (var id in cache) {
                cache[ id ].removeAttribute(ATTR_PASTE_INLINE);
            }

            this.fire('updateSnapshot');
        },

        _onIterateInline: function(event) {
            var cmdLoader = this.getCommand(CMD_LOADER);
            cmdLoader.setState(CKEDITOR.TRISTATE_ON);

            // @config CKEDITOR.config.imageUploadUrl
            var uploadUrl = CKEDITOR.fileTools.getUploadUrl(this.config, 'image');
            var loader = this.uploadRepository.create(event.data);

            var that = this;

            loader.on('uploaded', this.plugins.pastefile._onImageUploaded.bind(this, loader));
            loader.on('error', function(event) {
                that.fire('pastefile:loadfailed', event);
            });
            [ 'uploaded', 'abort', 'error' ].forEach(function(cbName) {
                loader.on(cbName, function() {
                    cmdLoader.setState(CKEDITOR.TRISTATE_OFF);
                });
            });

            loader.loadAndUpload(uploadUrl, this.config.pastefileUploadPostParam);
        },

        _hasImage: function(data) {
            if (!data || !Array.isArray(data)) {
                return false;
            }

            return data.some(function(item) {
                return CKEDITOR.fileTools.isTypeSupported(item, REG_IMAGE_TYPE);
            })
        },

        _onIterateFile: function(event) {
            if (this.config.pastefileDisableFile) {
                return;
            }

            var data = Array.isArray(event.data) ? event.data : [ event.data ];

            var plugin = this.plugins.pastefile;
            var info = {
                hasImage: plugin._hasImage(data)
            };

            this.fire('pastefile:dropfile', { files: data, info: info });
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

            element.once('load', function() {
                this.insertHtml(element.getOuterHtml(), 'unfiltered_html');
            }, this);

            attrs[ ATTR_PASTE_IGNORE ] = '1';
            element.setAttributes(attrs);
        },

        /**
         * @this {Editor}
         */
        _dropContextReset: function() {
            if (this._pastefileDNDHover) {
                this._pastefileDNDHover.destroy();
                delete this._pastefileDNDHover;
            }

            var cmdMaximize = this.getCommand('maximize');
            var isMaximize = (cmdMaximize && cmdMaximize.state === CKEDITOR.TRISTATE_ON);
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
            if (command.state === CKEDITOR.TRISTATE_DISABLED || this.config.pastefileDisableContext) {
                return;
            }

            var plugin = this.plugins.pastefile;
            var info;

            var data = event.data.dataTransfer.files;
            if (data && data.length) {
                data = Array.isArray(data) ? data : Array.prototype.slice.call(data);
                info = {
                    hasImage: plugin._hasImage(data)
                };

                this.fire('pastefile:dropfile', { files: data, info: info });
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
                var data = new ClipboardDataIterator(event.data.dataTransfer, this.config.pastefileInlineMaxSize).search();

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
        this._isShow = false;
        this._stopDropPropagation = false;

        for (var methodName in this.METHODS_BINDS) {
            this[ methodName ] = this[ methodName ].bind(this);
        }

        this._leaveDebounce = _.debounce(this._leave, 100);
        this._onScrollThrottle = _.throttle(this._onScroll, 50);

        this._editor.on('drop', this._onDropEditor, this, null, -1);

        var editable = this._editor.editable();
        if (editable) {
            editable.on('scroll', this._onScrollThrottle);
        }

        for (var eventName in this.BASE_DRAG_EVENTS) {
            document.addEventListener(eventName, this[ this.BASE_DRAG_EVENTS[ eventName ] ], false);
        }
    }

    CKEDITOR.event.implementOn(DNDHover.prototype);

    DNDHover.prototype.LABEL_PREVENTED = 'application/x-drag-prevented';

    DNDHover.prototype.METHODS_BINDS = {
        '_leave': 1,
        '_onDragend': 1,
        '_onDragenter': 1,
        '_onDragover': 1,
        '_onDragstart': 1,
        '_onDrop': 1,
        '_onScroll': 1
    };

    DNDHover.prototype.BASE_DRAG_EVENTS = {
        'dragend': '_onDragend',
        'dragenter': '_onDragenter',
        'dragover': '_onDragover',
        'dragstart': '_onDragstart',
        'drop': '_onDrop',
        'scroll': '_onScrollThrottle'
    };

    DNDHover.prototype._iteratorsDragPrevented = {
        'items': function(item) {
            return (item.type === this.LABEL_PREVENTED);
        },

        'types': function(item) {
            return (item === this.LABEL_PREVENTED);
        }
    };

    DNDHover.prototype._isDragPrevented = function(event) {
        var items;
        var callback;

        if (event.dataTransfer.items) {
            items = event.dataTransfer.items;
            callback = this._iteratorsDragPrevented.items;

        } else if (event.dataTransfer.types) {
            items = event.dataTransfer.types;
            callback = this._iteratorsDragPrevented.types;
        }

        if (!items) {
            return false;
        }

        return Array.prototype.some.call(items, callback, this);
    };

    DNDHover.prototype._onDragstart = function(event) {
        if (event.target.tagName !== 'IMG') {
            event.dataTransfer.setData(this.LABEL_PREVENTED, '1');
        }
    };

    DNDHover.prototype._onDragenter = function(event) {
        if (!this._isShow && !this._isDragPrevented(event)) {
            this._isShow = true;
            this.fire('enter', event);
        }
    };

    /**
     * Drop в редактор наступает раньше drop на windows.
     * И действие drop на windows нужно обрабатывать только если до этого не наступил drop в редакторе.
     * Drop редактор сам обрабатывает.
     * Иначе будет двойная обработка.
     */
    DNDHover.prototype._onDropEditor = function() {
        this._stopDropPropagation = true;
        this._leave();
    };

    DNDHover.prototype._onDrop = function(event) {
        event.preventDefault();

        var isDropAction = (
            !this._stopDropPropagation &&
            (this._dropContext === event.target || (this._dropContext.compareDocumentPosition(event.target) & Node.DOCUMENT_POSITION_CONTAINED_BY))
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

    DNDHover.prototype._onDragend = function() {
        this._stopDropPropagation = false;
        this._leave();
    };

    DNDHover.prototype._onScroll = function() {
        if (this._isShow) {
            this._leaveDebounce();
        }
    };

    DNDHover.prototype._leave = function() {
        if (this._isShow) {
            this._isShow = false;
            this.fire('leave');
        }
    };

    DNDHover.prototype.destroy = function() {
        var editable = this._editor.editable();
        if (editable) {
            editable.removeListener('scroll', this._onScrollThrottle);
        }

        this.removeAllListeners();
        this._editor.removeListener('drop', this._onDropEditor);

        for (var eventName in this.BASE_DRAG_EVENTS) {
            document.removeEventListener(eventName, this[ this.BASE_DRAG_EVENTS[ eventName ] ], false);
        }

        this._dropContext = null;
    };


    function ClipboardDataIterator(data, maxInlineSize) {
        this._data = data;
        this._items = [];
        this._iterator = _.noop;
        this._iteratorSearch = _.noop;

        this._maxSize = maxInlineSize || this.DEFAULT_MAX_SIZE;

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

    ClipboardDataIterator.prototype.DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

    ClipboardDataIterator.prototype.REG_IMAGE_TYPE = REG_IMAGE_TYPE;

    ClipboardDataIterator.prototype.REG_BREAK_TYPE = /text\/(rtf|plain)/;

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

    ClipboardDataIterator.prototype._iteratorsSearch = {
        'files': function(data, item) {
            if (CKEDITOR.fileTools.isTypeSupported(item, this.REG_IMAGE_TYPE)) {
                if (item.size <= this._maxSize) {
                    data.inline = true;
                }

            } else {
                data.file = true;
            }

            return false;
        },

        'items': function(data, item) {
            if (CKEDITOR.fileTools.isTypeSupported(item, this.REG_IMAGE_TYPE)) {
                data.inline = true;

            } else if (item.kind === 'file') {
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
                if (item.size <= this._maxSize) {
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
                if (blob && blob.size <= this._maxSize) {
                    data.prevent = true;
                    this.fire('iterator:inline', blob);
                    return true;
                }
            }

            return false;
        },

        'types': function(data, item) {
            return false;
        }
    };

}());
